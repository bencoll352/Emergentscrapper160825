from fastapi import FastAPI, APIRouter, HTTPException, Query, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import os
import logging
import googlemaps
import pgeocode
import asyncio
import httpx
from pathlib import Path
import uuid
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Google Maps client
GOOGLE_API_KEY = os.environ.get('GOOGLE_PLACES_API_KEY')
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_PLACES_API_KEY not found in environment variables")

# Companies House API client
COMPANIES_HOUSE_API_KEY = os.environ.get('COMPANIES_HOUSE_API_KEY')
if not COMPANIES_HOUSE_API_KEY:
    raise ValueError("COMPANIES_HOUSE_API_KEY not found in environment variables")

gmaps = googlemaps.Client(key=GOOGLE_API_KEY)

# UK postcode lookup
nomi = pgeocode.Nominatim('gb')

# Companies House API base URL
COMPANIES_HOUSE_BASE_URL = "https://api.company-information.service.gov.uk"

# Create the main app
app = FastAPI(title="UK Trade Contact Intelligence API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Data Models
class BusinessSearchRequest(BaseModel):
    location: str  # UK postcode or address
    radius: int = 20000  # meters (default 20km = ~12.4 miles)
    business_types: List[str] = ["carpenter", "builder", "electrician", "plumber"]
    max_results: int = 50
    enhance_with_companies_house: bool = True

class CompaniesHouseData(BaseModel):
    company_number: Optional[str] = None
    official_name: Optional[str] = None
    company_status: Optional[str] = None
    registered_address: Optional[dict] = None
    sic_codes: Optional[List[str]] = None
    directors: Optional[List[dict]] = None
    incorporation_date: Optional[str] = None

class BusinessInfo(BaseModel):
    place_id: str
    company_name: str
    tradesperson_name: Optional[str] = None
    primary_industry: str 
    full_address: str
    postcode: Optional[str] = None
    website_url: Optional[str] = None
    phone_number: Optional[str] = None
    email_address: Optional[str] = None
    source_url: str = "Google Places API"
    date_of_scraping: str
    rating: Optional[float] = None
    total_ratings: Optional[int] = None
    location: dict
    companies_house_data: Optional[CompaniesHouseData] = None
    verification_status: str = "unverified"

class SearchResponse(BaseModel):
    success: bool
    total_found: int
    businesses: List[BusinessInfo]
    search_location: dict
    search_params: dict

# Companies House API Functions
async def search_companies_house(company_name: str, max_results: int = 5):
    """Search Companies House for companies by name"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{COMPANIES_HOUSE_BASE_URL}/search/companies",
                params={
                    "q": company_name,
                    "items_per_page": max_results,
                    "start_index": 0
                },
                auth=(COMPANIES_HOUSE_API_KEY, ""),
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("items", [])
            else:
                logging.warning(f"Companies House search failed for {company_name}: {response.status_code}")
                return []
    except Exception as e:
        logging.error(f"Error searching Companies House for {company_name}: {str(e)}")
        return []

async def get_company_profile(company_number: str):
    """Get detailed company profile from Companies House"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}",
                auth=(COMPANIES_HOUSE_API_KEY, ""),
                timeout=10.0
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logging.warning(f"Companies House profile failed for {company_number}: {response.status_code}")
                return None
    except Exception as e:
        logging.error(f"Error getting company profile for {company_number}: {str(e)}")
        return None

async def get_company_officers(company_number: str):
    """Get company directors/officers from Companies House"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}/officers",
                auth=(COMPANIES_HOUSE_API_KEY, ""),
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("items", [])
            else:
                logging.warning(f"Companies House officers failed for {company_number}: {response.status_code}")
                return []
    except Exception as e:
        logging.error(f"Error getting company officers for {company_number}: {str(e)}")
        return []

def calculate_name_similarity(name1: str, name2: str) -> float:
    """Calculate similarity between two company names"""
    name1 = re.sub(r'[^\w\s]', '', name1.lower()).strip()
    name2 = re.sub(r'[^\w\s]', '', name2.lower()).strip()
    
    # Remove common business suffixes
    suffixes = ['ltd', 'limited', 'plc', 'llp', 'limited liability partnership', 'company', 'co']
    for suffix in suffixes:
        name1 = name1.replace(f' {suffix}', '').replace(f'{suffix} ', '')
        name2 = name2.replace(f' {suffix}', '').replace(f'{suffix} ', '')
    
    # Simple word overlap calculation
    words1 = set(name1.split())
    words2 = set(name2.split())
    
    if not words1 or not words2:
        return 0.0
    
    intersection = words1.intersection(words2)
    union = words1.union(words2)
    
    return len(intersection) / len(union) if union else 0.0

async def enhance_with_companies_house_data(business_name: str, postcode: str = None) -> Optional[CompaniesHouseData]:
    """Enhance business data with Companies House information"""
    try:
        # Search for companies with similar names
        companies = await search_companies_house(business_name, max_results=10)
        
        if not companies:
            return None
        
        # Find best matching company
        best_match = None
        best_similarity = 0.0
        
        for company in companies:
            similarity = calculate_name_similarity(business_name, company.get("title", ""))
            
            # Bonus points if postcode matches
            if postcode and company.get("address", {}).get("postal_code"):
                if postcode.replace(" ", "").upper() in company["address"]["postal_code"].replace(" ", "").upper():
                    similarity += 0.3
            
            if similarity > best_similarity and similarity > 0.4:  # Minimum 40% similarity
                best_match = company
                best_similarity = similarity
        
        if not best_match:
            return None
        
        company_number = best_match["company_number"]
        
        # Get detailed profile and officers
        profile, officers = await asyncio.gather(
            get_company_profile(company_number),
            get_company_officers(company_number),
            return_exceptions=True
        )
        
        if isinstance(profile, Exception) or not profile:
            return None
        
        # Process officers data
        directors_data = []
        if not isinstance(officers, Exception) and officers:
            for officer in officers[:5]:  # Limit to first 5 officers
                directors_data.append({
                    "name": officer.get("name", ""),
                    "role": officer.get("officer_role", ""),
                    "appointed_on": officer.get("appointed_on", "")
                })
        
        return CompaniesHouseData(
            company_number=company_number,
            official_name=profile.get("company_name", ""),
            company_status=profile.get("company_status", ""),
            registered_address=profile.get("registered_office_address", {}),
            sic_codes=profile.get("sic_codes", []),
            directors=directors_data,
            incorporation_date=profile.get("date_of_creation", "")
        )
        
    except Exception as e:
        logging.error(f"Error enhancing with Companies House data for {business_name}: {str(e)}")
        return None

# Helper Functions (existing functions remain the same)
def convert_postcode_to_coordinates(postcode: str):
    """Convert UK postcode to latitude/longitude coordinates"""
    try:
        postcode = postcode.upper().strip()
        location_info = nomi.query_postal_code(postcode)
        
        if location_info.latitude and location_info.longitude:
            return {
                "lat": float(location_info.latitude),
                "lng": float(location_info.longitude)
            }
        else:
            raise ValueError(f"Invalid UK postcode: {postcode}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Postcode conversion error: {str(e)}")

def extract_postcode_from_address(address: str) -> Optional[str]:
    """Extract UK postcode from address string"""
    # UK postcode regex pattern
    postcode_pattern = r'([A-Z]{1,2}[0-9R][0-9A-Z]? ?[0-9][A-Z]{2})'
    match = re.search(postcode_pattern, address.upper())
    return match.group(1) if match else None

def map_business_type_to_google_type(business_type: str) -> tuple:
    """Map our business types to Google Places types and keywords"""
    type_mapping = {
        "carpenter": ("general_contractor", "carpenter joiner"),
        "builder": ("general_contractor", "builder construction"),
        "electrician": ("electrician", "electrician electrical contractor"),
        "plumber": ("plumber", "plumber plumbing services"),
        "roofer": ("roofing_contractor", "roofer roofing services"),
        "painter": ("painter", "painter decorator"),
        "landscaper": ("general_contractor", "landscaper gardening"),
        "plasterer": ("general_contractor", "plasterer plastering services"),
        "groundworker": ("general_contractor", "groundwork excavation"),
        "bricklayer": ("general_contractor", "bricklayer masonry"),
        "heating_engineer": ("plumber", "heating engineer boiler"),
        "kitchen_fitter": ("general_contractor", "kitchen fitter"),
        "bathroom_fitter": ("general_contractor", "bathroom fitter"),
        "tiler": ("general_contractor", "tiler tiling services"),
        "decorator": ("painter", "decorator painting services")
    }
    
    return type_mapping.get(business_type.lower(), ("general_contractor", business_type))

async def process_place_details(place: dict, business_type: str, enhance_with_ch: bool = True) -> Optional[BusinessInfo]:
    """Extract and format business details from Google Places result"""
    try:
        # Get detailed information
        place_details = gmaps.place(
            place_id=place['place_id'],
            fields=['name', 'formatted_address', 'formatted_phone_number', 
                   'website', 'rating', 'user_ratings_total', 'opening_hours']
        )
        
        details = place_details.get('result', {})
        address = details.get('formatted_address', '')
        postcode = extract_postcode_from_address(address)
        company_name = details.get('name', 'Unknown')
        
        # Map business type to our industry categories
        industry_mapping = {
            "carpenter": "Carpenters & Joiners",
            "builder": "General Builders", 
            "electrician": "Electricians",
            "plumber": "Plumbers",
            "roofer": "Roofing Specialists",
            "painter": "Decorators",
            "landscaper": "Landscapers",
            "plasterer": "Plasterers",
            "groundworker": "Groundworkers",
            "bricklayer": "Bricklayers & Stonemasons",
            "heating_engineer": "Heating Engineers",
            "kitchen_fitter": "Kitchen Fitters",
            "bathroom_fitter": "Property Maintenance",
            "tiler": "Tilers",
            "decorator": "Decorators"
        }
        
        # Enhance with Companies House data if requested
        companies_house_data = None
        verification_status = "unverified"
        
        if enhance_with_ch:
            companies_house_data = await enhance_with_companies_house_data(company_name, postcode)
            if companies_house_data:
                if companies_house_data.company_status == "active":
                    verification_status = "verified"
                else:
                    verification_status = "inactive"
        
        return BusinessInfo(
            place_id=place['place_id'],
            company_name=company_name,
            tradesperson_name=None,  # Google Places doesn't provide individual names
            primary_industry=industry_mapping.get(business_type.lower(), business_type.title()),
            full_address=address,
            postcode=postcode,
            website_url=details.get('website'),
            phone_number=details.get('formatted_phone_number'),
            email_address=None,  # Google Places doesn't provide emails
            source_url="Google Places API + Companies House API",
            date_of_scraping=datetime.now().strftime("%Y-%m-%d"),
            rating=details.get('rating'),
            total_ratings=details.get('user_ratings_total'),
            location={
                "type": "Point",
                "coordinates": [
                    place['geometry']['location']['lng'],
                    place['geometry']['location']['lat']
                ]
            },
            companies_house_data=companies_house_data,
            verification_status=verification_status
        )
    except Exception as e:
        logging.error(f"Error processing place details: {str(e)}")
        return None

async def cache_business_info(business_info: BusinessInfo):
    """Cache business information in MongoDB"""
    try:
        await db.businesses.update_one(
            {"place_id": business_info.place_id},
            {"$set": {**business_info.dict(), "last_updated": datetime.utcnow()}},
            upsert=True
        )
    except Exception as e:
        logging.error(f"Error caching business info: {str(e)}")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "UK Trade Contact Intelligence API with Companies House Integration"}

@api_router.post("/search-businesses", response_model=SearchResponse)
async def search_businesses(search_request: BusinessSearchRequest):
    """Search for construction and trade businesses near a UK location with Companies House enhancement"""
    try:
        # Convert postcode/address to coordinates
        coordinates = None
        
        # Check if it's a UK postcode format
        if search_request.location.replace(" ", "").isalnum() and len(search_request.location.replace(" ", "")) <= 8:
            # Likely a UK postcode
            coordinates = convert_postcode_to_coordinates(search_request.location)
        else:
            # Use geocoding for full address
            geocode_result = gmaps.geocode(search_request.location + ", UK")
            if not geocode_result:
                raise HTTPException(status_code=400, detail="Location not found")
            coordinates = geocode_result[0]['geometry']['location']

        all_businesses = []
        processed_place_ids = set()
        
        # Search for each business type
        for business_type in search_request.business_types:
            google_type, keyword = map_business_type_to_google_type(business_type)
            
            try:
                # Perform nearby search
                places_result = gmaps.places_nearby(
                    location=coordinates,
                    radius=search_request.radius,
                    type=google_type,
                    keyword=keyword
                )
                
                # Process results
                for place in places_result.get('results', []):
                    if place['place_id'] not in processed_place_ids:
                        processed_place_ids.add(place['place_id'])
                        business_info = await process_place_details(
                            place, 
                            business_type, 
                            search_request.enhance_with_companies_house
                        )
                        if business_info:
                            all_businesses.append(business_info)
                            # Cache in MongoDB
                            await cache_business_info(business_info)
                
                # Handle pagination if needed and we haven't reached max results
                while ('next_page_token' in places_result and 
                       len(all_businesses) < search_request.max_results):
                    await asyncio.sleep(2)  # Required delay for next_page_token
                    try:
                        places_result = gmaps.places_nearby(
                            page_token=places_result['next_page_token']
                        )
                        
                        for place in places_result.get('results', []):
                            if place['place_id'] not in processed_place_ids:
                                processed_place_ids.add(place['place_id'])
                                business_info = await process_place_details(
                                    place, 
                                    business_type, 
                                    search_request.enhance_with_companies_house
                                )
                                if business_info:
                                    all_businesses.append(business_info)
                                    await cache_business_info(business_info)
                    except Exception as pagination_error:
                        logging.warning(f"Pagination error for {business_type}: {str(pagination_error)}")
                        break
                        
            except Exception as search_error:
                logging.error(f"Search error for {business_type}: {str(search_error)}")
                continue

        # Limit results
        limited_results = all_businesses[:search_request.max_results]
        
        return SearchResponse(
            success=True,
            total_found=len(limited_results),
            businesses=limited_results,
            search_location=coordinates,
            search_params=search_request.dict()
        )
        
    except Exception as e:
        logging.error(f"Search error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@api_router.get("/cached-businesses")
async def get_cached_businesses(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: int = Query(20000),
    business_type: Optional[str] = None,
    verified_only: bool = Query(False)
):
    """Get cached businesses from MongoDB using geospatial query"""
    try:
        # First, create geospatial index if it doesn't exist
        try:
            await db.businesses.create_index([("location", "2dsphere")])
        except Exception:
            pass  # Index might already exist
            
        query = {
            "location": {
                "$nearSphere": {
                    "$geometry": {
                        "type": "Point",
                        "coordinates": [lng, lat]
                    },
                    "$maxDistance": radius
                }
            }
        }
        
        if business_type:
            query["primary_industry"] = business_type
            
        if verified_only:
            query["verification_status"] = "verified"
            
        businesses = await db.businesses.find(query).limit(100).to_list(100)
        
        # Convert ObjectId to string for JSON serialization
        for business in businesses:
            business['_id'] = str(business['_id'])
            
        return {
            "success": True,
            "total_found": len(businesses),
            "businesses": businesses
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cache query failed: {str(e)}")

@api_router.get("/company/{company_number}")
async def get_company_details(company_number: str):
    """Get detailed company information from Companies House"""
    try:
        profile = await get_company_profile(company_number)
        if not profile:
            raise HTTPException(status_code=404, detail="Company not found")
        
        officers = await get_company_officers(company_number)
        
        return {
            "success": True,
            "company": profile,
            "officers": officers
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error getting company details: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch company details")

@api_router.get("/search/companies")
async def search_companies_endpoint(
    query: str = Query(..., min_length=2, max_length=100),
    items_per_page: int = Query(20, ge=1, le=100)
):
    """Search for companies in Companies House"""
    try:
        companies = await search_companies_house(query, items_per_page)
        return {
            "success": True,
            "total_found": len(companies),
            "companies": companies
        }
    except Exception as e:
        logging.error(f"Error searching companies: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to search companies")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelevel)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    """Initialize database indexes on startup"""
    try:
        await db.businesses.create_index([("location", "2dsphere")])
        await db.businesses.create_index("place_id", unique=True)
        logger.info("Database indexes created successfully")
    except Exception as e:
        logger.error(f"Error creating database indexes: {str(e)}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
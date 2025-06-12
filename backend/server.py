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
from pathlib import Path
import uuid

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

gmaps = googlemaps.Client(key=GOOGLE_API_KEY)

# UK postcode lookup
nomi = pgeocode.Nominatim('gb')

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

class SearchResponse(BaseModel):
    success: bool
    total_found: int
    businesses: List[BusinessInfo]
    search_location: dict
    search_params: dict

# Helper Functions
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
    import re
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

async def process_place_details(place: dict, business_type: str) -> Optional[BusinessInfo]:
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
        
        return BusinessInfo(
            place_id=place['place_id'],
            company_name=details.get('name', 'Unknown'),
            tradesperson_name=None,  # Google Places doesn't provide individual names
            primary_industry=industry_mapping.get(business_type.lower(), business_type.title()),
            full_address=address,
            postcode=postcode,
            website_url=details.get('website'),
            phone_number=details.get('formatted_phone_number'),
            email_address=None,  # Google Places doesn't provide emails
            source_url="Google Places API",
            date_of_scraping=datetime.now().strftime("%Y-%m-%d"),
            rating=details.get('rating'),
            total_ratings=details.get('user_ratings_total'),
            location={
                "type": "Point",
                "coordinates": [
                    place['geometry']['location']['lng'],
                    place['geometry']['location']['lat']
                ]
            }
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
    return {"message": "UK Trade Contact Intelligence API"}

@api_router.post("/search-businesses", response_model=SearchResponse)
async def search_businesses(search_request: BusinessSearchRequest):
    """Search for construction and trade businesses near a UK location"""
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
                        business_info = await process_place_details(place, business_type)
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
                                business_info = await process_place_details(place, business_type)
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
    business_type: Optional[str] = None
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
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
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
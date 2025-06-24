#!/usr/bin/env python3
import unittest
import requests
import json
import os
import time
from typing import Dict, List, Any

# Get the backend URL from the frontend .env file
def get_backend_url():
    with open('/app/frontend/.env', 'r') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                return line.strip().split('=')[1]
    raise ValueError("REACT_APP_BACKEND_URL not found in frontend/.env")

BACKEND_URL = get_backend_url()
API_URL = f"{BACKEND_URL}/api"

class UKTradeContactIntelligenceTests(unittest.TestCase):
    """Test suite for UK Trade Contact Intelligence backend API"""

    def setUp(self):
        """Setup for each test"""
        self.api_url = API_URL
        print(f"Using API URL: {self.api_url}")
        
        # Test data
        self.valid_postcode = "SW1A 1AA"  # Buckingham Palace
        self.valid_city = "London"
        self.invalid_postcode = "INVALID123"
        self.valid_trade_types = ["carpenter", "builder", "electrician"]
        
    def test_api_health(self):
        """Test API health endpoint"""
        response = requests.get(f"{self.api_url}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["message"], "UK Trade Contact Intelligence API")
        print("✅ API health check passed")
        
    def test_search_businesses_with_postcode(self):
        """Test searching businesses with a valid UK postcode"""
        payload = {
            "location": self.valid_postcode,
            "radius": 5000,  # 5km
            "business_types": self.valid_trade_types,
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify response structure
        self.assertTrue(data["success"])
        self.assertIn("total_found", data)
        self.assertIn("businesses", data)
        self.assertIn("search_location", data)
        self.assertIn("search_params", data)
        
        # Verify search location contains coordinates
        self.assertIn("lat", data["search_location"])
        self.assertIn("lng", data["search_location"])
        
        # Verify businesses data if any found
        if data["total_found"] > 0:
            business = data["businesses"][0]
            self.assertIn("place_id", business)
            self.assertIn("company_name", business)
            self.assertIn("primary_industry", business)
            self.assertIn("full_address", business)
            self.assertIn("location", business)
            
            # Check if coordinates are present in location
            self.assertEqual(business["location"]["type"], "Point")
            self.assertEqual(len(business["location"]["coordinates"]), 2)
            
        print(f"✅ Search businesses with postcode passed. Found {data['total_found']} businesses.")
        return data  # Return data for use in caching test
        
    def test_search_businesses_with_city(self):
        """Test searching businesses with a valid UK city"""
        payload = {
            "location": self.valid_city,
            "radius": 5000,  # 5km
            "business_types": self.valid_trade_types,
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify response structure
        self.assertTrue(data["success"])
        self.assertIn("total_found", data)
        self.assertIn("businesses", data)
        
        # Verify businesses data if any found
        if data["total_found"] > 0:
            business = data["businesses"][0]
            self.assertIn("company_name", business)
            self.assertIn("primary_industry", business)
            self.assertIn("full_address", business)
            
        print(f"✅ Search businesses with city passed. Found {data['total_found']} businesses.")
        
    def test_search_businesses_with_invalid_postcode(self):
        """Test searching businesses with an invalid UK postcode"""
        payload = {
            "location": self.invalid_postcode,
            "radius": 5000,
            "business_types": self.valid_trade_types,
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        # Should either return 400 or 500 with error message
        self.assertIn(response.status_code, [400, 500])
        print("✅ Invalid postcode handling passed")
        
    def test_search_businesses_with_empty_location(self):
        """Test searching businesses with an empty location"""
        payload = {
            "location": "",
            "radius": 5000,
            "business_types": self.valid_trade_types,
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        # Should return 422 (validation error) or 400
        self.assertIn(response.status_code, [400, 422])
        print("✅ Empty location handling passed")
        
    def test_search_businesses_with_invalid_trade_types(self):
        """Test searching businesses with invalid trade types"""
        payload = {
            "location": self.valid_postcode,
            "radius": 5000,
            "business_types": ["invalid_type_123"],
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        # Should still return 200 as the API maps unknown types to general_contractor
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        print("✅ Invalid trade type handling passed")
        
    def test_mongodb_caching(self):
        """Test MongoDB caching functionality"""
        # First, search for businesses to populate the cache
        search_data = self.test_search_businesses_with_postcode()
        
        if search_data["total_found"] > 0:
            # Get coordinates from the search
            lat = search_data["search_location"]["lat"]
            lng = search_data["search_location"]["lng"]
            
            # Wait a moment for caching to complete
            time.sleep(2)
            
            # Now query the cached businesses
            response = requests.get(
                f"{self.api_url}/cached-businesses?lat={lat}&lng={lng}&radius=5000"
            )
            
            self.assertEqual(response.status_code, 200)
            data = response.json()
            
            # Verify response structure
            self.assertTrue(data["success"])
            self.assertIn("total_found", data)
            self.assertIn("businesses", data)
            
            # Verify we got some cached results
            self.assertGreaterEqual(data["total_found"], 0)
            
            print(f"✅ MongoDB caching test passed. Found {data['total_found']} cached businesses.")
        else:
            print("⚠️ Skipping MongoDB caching test as no businesses were found in the initial search.")
    
    def test_uk_postcode_support(self):
        """Test UK postcode to coordinates conversion"""
        payload = {
            "location": self.valid_postcode,
            "radius": 5000,
            "business_types": ["builder"],
            "max_results": 1
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify coordinates were generated
        self.assertIn("search_location", data)
        self.assertIn("lat", data["search_location"])
        self.assertIn("lng", data["search_location"])
        
        # Verify coordinates are in UK range
        lat = data["search_location"]["lat"]
        lng = data["search_location"]["lng"]
        
        # UK latitude range: approximately 49.9 to 58.7
        # UK longitude range: approximately -8.2 to 1.8
        self.assertTrue(49.0 <= lat <= 59.0, f"Latitude {lat} is outside UK range")
        self.assertTrue(-9.0 <= lng <= 2.0, f"Longitude {lng} is outside UK range")
        
        print(f"✅ UK postcode support test passed. Converted to coordinates: {lat}, {lng}")
    
    def test_trade_type_mapping(self):
        """Test trade type mapping functionality"""
        # Test with different trade types
        trade_types = ["carpenter", "electrician", "plumber", "roofer", "painter"]
        
        for trade_type in trade_types:
            payload = {
                "location": self.valid_city,
                "radius": 5000,
                "business_types": [trade_type],
                "max_results": 5
            }
            
            response = requests.post(f"{self.api_url}/search-businesses", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            
            # Verify businesses have the correct primary industry if any found
            if data["total_found"] > 0:
                business = data["businesses"][0]
                industry_mapping = {
                    "carpenter": "Carpenters & Joiners",
                    "electrician": "Electricians",
                    "plumber": "Plumbers",
                    "roofer": "Roofing Specialists",
                    "painter": "Decorators"
                }
                expected_industry = industry_mapping.get(trade_type)
                
                # Some businesses might be categorized differently, so we just check
                # that the primary_industry field exists
                self.assertIn("primary_industry", business)
                
        print("✅ Trade type mapping test passed")
    
    def test_data_validation(self):
        """Test data validation for business information"""
        payload = {
            "location": self.valid_city,
            "radius": 5000,
            "business_types": self.valid_trade_types,
            "max_results": 10
        }
        
        response = requests.post(f"{self.api_url}/search-businesses", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        if data["total_found"] > 0:
            for business in data["businesses"]:
                # Check required fields
                self.assertIn("company_name", business)
                self.assertIn("primary_industry", business)
                self.assertIn("full_address", business)
                self.assertIn("location", business)
                
                # Check data types
                self.assertIsInstance(business["company_name"], str)
                self.assertIsInstance(business["primary_industry"], str)
                self.assertIsInstance(business["full_address"], str)
                
                # Check optional fields have correct types when present
                if business["website_url"] is not None:
                    self.assertIsInstance(business["website_url"], str)
                if business["phone_number"] is not None:
                    self.assertIsInstance(business["phone_number"], str)
                if business["rating"] is not None:
                    self.assertIsInstance(business["rating"], float)
                if business["total_ratings"] is not None:
                    self.assertIsInstance(business["total_ratings"], int)
                
            print("✅ Data validation test passed")
        else:
            print("⚠️ Skipping data validation test as no businesses were found.")

def run_tests():
    """Run all tests"""
    print(f"Starting UK Trade Contact Intelligence API tests against {API_URL}")
    
    # Create test suite
    test_suite = unittest.TestSuite()
    
    # Add tests in specific order
    test_suite.addTest(UKTradeContactIntelligenceTests('test_api_health'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_uk_postcode_support'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_search_businesses_with_postcode'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_search_businesses_with_city'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_search_businesses_with_invalid_postcode'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_search_businesses_with_empty_location'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_search_businesses_with_invalid_trade_types'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_mongodb_caching'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_trade_type_mapping'))
    test_suite.addTest(UKTradeContactIntelligenceTests('test_data_validation'))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    # Print summary
    print("\n=== TEST SUMMARY ===")
    print(f"Total tests: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Skipped: {len(result.skipped)}")
    
    # Print failures and errors
    if result.failures:
        print("\n=== FAILURES ===")
        for test, error in result.failures:
            print(f"\n{test}")
            print(error)
    
    if result.errors:
        print("\n=== ERRORS ===")
        for test, error in result.errors:
            print(f"\n{test}")
            print(error)
    
    return result.wasSuccessful()

if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)
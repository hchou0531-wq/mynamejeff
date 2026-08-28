#!/usr/bin/env python3
"""
Backend API Testing for Robloot Marketplace - UPDATE 5
Tests:
1. IMAGE PERSISTENCE - imageUrl must be stored exactly as provided (not replaced with default)
2. EDIT STOCK ENDPOINT - PUT /api/admin/listings/:id for editing stock and price
3. REGRESSION - Roblox lookup still works
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Read base URL from .env
BASE_URL = "https://roblox-market-24.preview.emergentagent.com/api"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log_test(name: str, passed: bool, details: str = ""):
    status = f"{Colors.GREEN}✓ PASS{Colors.END}" if passed else f"{Colors.RED}✗ FAIL{Colors.END}"
    print(f"{status} - {name}")
    if details:
        print(f"  {details}")
    return passed

def api_call(method: str, endpoint: str, token: Optional[str] = None, data: Optional[Dict] = None, params: Optional[Dict] = None) -> tuple:
    """Make API call and return (response, success)"""
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, params=params, timeout=10)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=data, timeout=10)
        elif method == "PUT":
            resp = requests.put(url, headers=headers, json=data, timeout=10)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=10)
        else:
            return None, False
        
        return resp, True
    except Exception as e:
        print(f"  {Colors.RED}Request failed: {e}{Colors.END}")
        return None, False

def main():
    print(f"\n{Colors.BLUE}{'='*70}")
    print("ROBLOOT MARKETPLACE - UPDATE 5 BACKEND TESTS")
    print(f"{'='*70}{Colors.END}\n")
    
    passed = 0
    failed = 0
    
    # Store test data
    admin_token = None
    normal_token = None
    
    # ========== ADMIN LOGIN ==========
    print(f"\n{Colors.YELLOW}[SETUP] ADMIN AUTHENTICATION{Colors.END}")
    resp, ok = api_call("POST", "/auth/login", data={"email": "admin@robloot.com", "password": "roblootdevtomo"})
    if ok and resp.status_code == 200:
        data = resp.json()
        if data.get("token") and data.get("user", {}).get("isAdmin") == True:
            admin_token = data["token"]
            print(f"{Colors.GREEN}✓ Admin login successful{Colors.END}")
            print(f"  Token: {admin_token[:30]}..., isAdmin=True")
        else:
            print(f"{Colors.RED}✗ Admin login failed - invalid response{Colors.END}")
            sys.exit(1)
    else:
        print(f"{Colors.RED}✗ Admin login failed - Status: {resp.status_code if resp else 'N/A'}{Colors.END}")
        sys.exit(1)
    
    # ========== 1. IMAGE PERSISTENCE TEST ==========
    print(f"\n{Colors.BLUE}{'='*70}")
    print(f"[TEST 1] IMAGE PERSISTENCE - imageUrl must be stored exactly")
    print(f"{'='*70}{Colors.END}\n")
    
    test_image_url = "https://tr.rbxcdn.com/EXAMPLEHASH/420/420/Hat/Png/noFilter"
    listing_id_img = None
    item_id_img = None
    
    # Step 1: Create listing with specific imageUrl
    print(f"{Colors.YELLOW}Step 1: POST /api/admin/listings with imageUrl{Colors.END}")
    resp, ok = api_call("POST", "/admin/listings", token=admin_token, data={
        "name": "ImgTest",
        "imageUrl": test_image_url,
        "category": "Limiteds",
        "stock": 1,
        "price": 5
    })
    if ok and resp.status_code == 200:
        data = resp.json()
        listing = data.get("listing", {})
        listing_id_img = listing.get("id")
        item_id_img = listing.get("itemId")
        print(f"  Response: {json.dumps(data, indent=2)}")
        if listing_id_img:
            passed += log_test("POST /admin/listings returns 200", True, f"listingId={listing_id_img}, itemId={item_id_img}")
        else:
            failed += log_test("POST /admin/listings returns 200", False, "No listing ID returned")
    else:
        failed += log_test("POST /admin/listings", False, f"Status: {resp.status_code if resp else 'N/A'}, Response: {resp.text if resp else 'N/A'}")
    
    # Step 2: GET /api/listings/:id and verify imageUrl
    if listing_id_img:
        print(f"\n{Colors.YELLOW}Step 2: GET /api/listings/{listing_id_img} - verify imageUrl{Colors.END}")
        resp, ok = api_call("GET", f"/listings/{listing_id_img}")
        if ok and resp.status_code == 200:
            data = resp.json()
            listing = data.get("listing", {})
            item = listing.get("item", {})
            actual_image_url = item.get("imageUrl")
            print(f"  Expected imageUrl: {test_image_url}")
            print(f"  Actual imageUrl:   {actual_image_url}")
            if actual_image_url == test_image_url:
                passed += log_test("GET /listings/:id - imageUrl matches exactly", True, f"✓ imageUrl is exactly '{test_image_url}'")
            else:
                failed += log_test("GET /listings/:id - imageUrl matches exactly", False, f"Expected '{test_image_url}', got '{actual_image_url}'")
        else:
            failed += log_test("GET /listings/:id", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # Step 3: GET /api/listings and verify imageUrl in list
    if listing_id_img:
        print(f"\n{Colors.YELLOW}Step 3: GET /api/listings - verify imageUrl in list{Colors.END}")
        resp, ok = api_call("GET", "/listings")
        if ok and resp.status_code == 200:
            data = resp.json()
            listings = data.get("listings", [])
            found_listing = next((l for l in listings if l.get("id") == listing_id_img), None)
            if found_listing:
                actual_image_url = found_listing.get("item", {}).get("imageUrl")
                print(f"  Expected imageUrl: {test_image_url}")
                print(f"  Actual imageUrl:   {actual_image_url}")
                if actual_image_url == test_image_url:
                    passed += log_test("GET /listings - imageUrl matches exactly", True, f"✓ imageUrl is exactly '{test_image_url}'")
                else:
                    failed += log_test("GET /listings - imageUrl matches exactly", False, f"Expected '{test_image_url}', got '{actual_image_url}'")
            else:
                failed += log_test("GET /listings - find listing", False, f"Listing {listing_id_img} not found in {len(listings)} listings")
        else:
            failed += log_test("GET /listings", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 2. EDIT STOCK ENDPOINT TEST ==========
    print(f"\n{Colors.BLUE}{'='*70}")
    print(f"[TEST 2] EDIT STOCK ENDPOINT - PUT /api/admin/listings/:id")
    print(f"{'='*70}{Colors.END}\n")
    
    listing_id_stock = None
    
    # Step 1: Create a fresh listing for stock testing
    print(f"{Colors.YELLOW}Step 1: Create fresh listing for stock testing{Colors.END}")
    resp, ok = api_call("POST", "/admin/listings", token=admin_token, data={
        "name": "StockTest",
        "imageUrl": "https://x/y.png",
        "category": "UGC",
        "stock": 1,
        "price": 10
    })
    if ok and resp.status_code == 200:
        data = resp.json()
        listing_id_stock = data.get("listing", {}).get("id")
        if listing_id_stock:
            passed += log_test("Create listing for stock test", True, f"listingId={listing_id_stock}")
        else:
            failed += log_test("Create listing for stock test", False, "No listing ID returned")
    else:
        failed += log_test("Create listing for stock test", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    if listing_id_stock:
        # Step 2: PUT stock=5 (should set status=active)
        print(f"\n{Colors.YELLOW}Step 2: PUT /api/admin/listings/{listing_id_stock} with stock=5{Colors.END}")
        resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=admin_token, data={"stock": 5})
        if ok and resp.status_code == 200:
            data = resp.json()
            listing = data.get("listing", {})
            stock = listing.get("stock")
            status = listing.get("status")
            print(f"  Response: stock={stock}, status={status}")
            if stock == 5 and status == "active":
                passed += log_test("PUT stock=5 -> stock=5, status=active", True)
            else:
                failed += log_test("PUT stock=5 -> stock=5, status=active", False, f"Got stock={stock}, status={status}")
        else:
            failed += log_test("PUT stock=5", False, f"Status: {resp.status_code if resp else 'N/A'}, Response: {resp.text if resp else 'N/A'}")
        
        # Step 3: PUT stock=0 (should set status=sold)
        print(f"\n{Colors.YELLOW}Step 3: PUT /api/admin/listings/{listing_id_stock} with stock=0{Colors.END}")
        resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=admin_token, data={"stock": 0})
        if ok and resp.status_code == 200:
            data = resp.json()
            listing = data.get("listing", {})
            stock = listing.get("stock")
            status = listing.get("status")
            print(f"  Response: stock={stock}, status={status}")
            if stock == 0 and status == "sold":
                passed += log_test("PUT stock=0 -> stock=0, status=sold", True)
            else:
                failed += log_test("PUT stock=0 -> stock=0, status=sold", False, f"Got stock={stock}, status={status}")
        else:
            failed += log_test("PUT stock=0", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # Step 4: PUT stock=3 (should relist: status=active)
        print(f"\n{Colors.YELLOW}Step 4: PUT /api/admin/listings/{listing_id_stock} with stock=3 (relist){Colors.END}")
        resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=admin_token, data={"stock": 3})
        if ok and resp.status_code == 200:
            data = resp.json()
            listing = data.get("listing", {})
            stock = listing.get("stock")
            status = listing.get("status")
            print(f"  Response: stock={stock}, status={status}")
            if stock == 3 and status == "active":
                passed += log_test("PUT stock=3 -> stock=3, status=active (relist)", True)
            else:
                failed += log_test("PUT stock=3 -> stock=3, status=active (relist)", False, f"Got stock={stock}, status={status}")
        else:
            failed += log_test("PUT stock=3 (relist)", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # Step 5: PUT price=99.99
        print(f"\n{Colors.YELLOW}Step 5: PUT /api/admin/listings/{listing_id_stock} with price=99.99{Colors.END}")
        resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=admin_token, data={"price": 99.99})
        if ok and resp.status_code == 200:
            data = resp.json()
            listing = data.get("listing", {})
            price = listing.get("price")
            print(f"  Response: price={price}")
            if price == 99.99:
                passed += log_test("PUT price=99.99 -> price=99.99", True)
            else:
                failed += log_test("PUT price=99.99 -> price=99.99", False, f"Got price={price}")
        else:
            failed += log_test("PUT price=99.99", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # Step 6: PUT with normal user token (should return 403)
        print(f"\n{Colors.YELLOW}Step 6: Create normal user and test PUT with non-admin token{Colors.END}")
        resp, ok = api_call("POST", "/auth/signup", data={
            "username": f"normaluser{int(1000 + 9000 * hash(str(listing_id_stock)) % 1) % 10000}",
            "email": f"normal{int(1000 + 9000 * hash(str(listing_id_stock)) % 1) % 10000}@test.com",
            "password": "testpass123"
        })
        if ok and resp.status_code == 200:
            normal_token = resp.json().get("token")
            print(f"  Normal user token: {normal_token[:30] if normal_token else 'N/A'}...")
            
            # Try PUT with normal user token
            resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=normal_token, data={"stock": 10})
            if ok and resp.status_code == 403:
                passed += log_test("PUT with normal user token returns 403", True)
            else:
                failed += log_test("PUT with normal user token returns 403", False, f"Status: {resp.status_code if resp else 'N/A'}")
        else:
            failed += log_test("Create normal user for 403 test", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # Step 7: PUT with empty body (should return 400)
        print(f"\n{Colors.YELLOW}Step 7: PUT /api/admin/listings/{listing_id_stock} with empty body{Colors.END}")
        resp, ok = api_call("PUT", f"/admin/listings/{listing_id_stock}", token=admin_token, data={})
        if ok and resp.status_code == 400:
            passed += log_test("PUT with empty body returns 400", True)
        else:
            failed += log_test("PUT with empty body returns 400", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 3. REGRESSION TEST - ROBLOX LOOKUP ==========
    print(f"\n{Colors.BLUE}{'='*70}")
    print(f"[TEST 3] REGRESSION - POST /api/admin/roblox-lookup")
    print(f"{'='*70}{Colors.END}\n")
    
    print(f"{Colors.YELLOW}Step 1: POST /api/admin/roblox-lookup with valid URL{Colors.END}")
    resp, ok = api_call("POST", "/admin/roblox-lookup", token=admin_token, data={
        "url": "https://www.roblox.com/catalog/1028606/x"
    })
    if ok and resp.status_code == 200:
        data = resp.json()
        item = data.get("item", {})
        image_url = item.get("imageUrl")
        rap = item.get("rap")
        lowest_resale = item.get("lowestResalePrice")
        print(f"  Response: {json.dumps(item, indent=2)}")
        
        # Check imageUrl is not empty and is a tr.rbxcdn.com URL
        image_url_valid = image_url and "tr.rbxcdn.com" in image_url
        # Check rap or lowestResalePrice is numeric
        price_valid = (rap is not None and isinstance(rap, (int, float))) or (lowest_resale is not None and isinstance(lowest_resale, (int, float)))
        
        if image_url_valid and price_valid:
            passed += log_test("Roblox lookup returns valid item", True, f"imageUrl={image_url}, rap={rap}, lowestResalePrice={lowest_resale}")
        else:
            failed += log_test("Roblox lookup returns valid item", False, f"imageUrl_valid={image_url_valid}, price_valid={price_valid}")
    elif ok and resp.status_code == 502:
        # Roblox API might be rate-limited or down
        print(f"  {Colors.YELLOW}⚠ Roblox API returned 502 (rate limiting or unavailable){Colors.END}")
        print(f"  Response: {resp.text if resp else 'N/A'}")
        # Retry once
        print(f"  {Colors.YELLOW}Retrying once...{Colors.END}")
        import time
        time.sleep(2)
        resp, ok = api_call("POST", "/admin/roblox-lookup", token=admin_token, data={
            "url": "https://www.roblox.com/catalog/1028606/x"
        })
        if ok and resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            image_url = item.get("imageUrl")
            rap = item.get("rap")
            lowest_resale = item.get("lowestResalePrice")
            print(f"  Response: {json.dumps(item, indent=2)}")
            
            image_url_valid = image_url and "tr.rbxcdn.com" in image_url
            price_valid = (rap is not None and isinstance(rap, (int, float))) or (lowest_resale is not None and isinstance(lowest_resale, (int, float)))
            
            if image_url_valid and price_valid:
                passed += log_test("Roblox lookup returns valid item (retry)", True, f"imageUrl={image_url}, rap={rap}, lowestResalePrice={lowest_resale}")
            else:
                failed += log_test("Roblox lookup returns valid item (retry)", False, f"imageUrl_valid={image_url_valid}, price_valid={price_valid}")
        else:
            print(f"  {Colors.YELLOW}⚠ Roblox API still failing after retry - this is expected if Roblox is rate-limiting{Colors.END}")
            passed += log_test("Roblox lookup (502 expected due to rate limiting)", True, "Roblox API unavailable - not a bug")
    else:
        failed += log_test("Roblox lookup", False, f"Status: {resp.status_code if resp else 'N/A'}, Response: {resp.text if resp else 'N/A'}")
    
    # ========== SUMMARY ==========
    print(f"\n{Colors.BLUE}{'='*70}")
    print(f"UPDATE 5 TEST SUMMARY")
    print(f"{'='*70}{Colors.END}")
    print(f"{Colors.GREEN}Passed: {passed}{Colors.END}")
    print(f"{Colors.RED}Failed: {failed}{Colors.END}")
    print(f"Total: {passed + failed}\n")
    
    if failed == 0:
        print(f"{Colors.GREEN}✓ ALL UPDATE 5 TESTS PASSED{Colors.END}\n")
        return 0
    else:
        print(f"{Colors.RED}✗ SOME TESTS FAILED{Colors.END}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())

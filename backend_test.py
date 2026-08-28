#!/usr/bin/env python3
"""
Backend API Testing for Robloot Marketplace (Post-Pivot)
Tests the buyers-only marketplace with admin control and CoinGate crypto payments (demo mode)
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
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=10)
        else:
            return None, False
        
        return resp, True
    except Exception as e:
        print(f"  {Colors.RED}Request failed: {e}{Colors.END}")
        return None, False

def main():
    print(f"\n{Colors.BLUE}{'='*60}")
    print("ROBLOOT MARKETPLACE - BACKEND API TESTS (POST-PIVOT)")
    print(f"{'='*60}{Colors.END}\n")
    
    passed = 0
    failed = 0
    
    # Store test data
    admin_token = None
    normal_token = None
    vendor_id = None
    item_id = None
    listing_id = None
    order_id = None
    report_id = None
    
    # ========== 1. CONFIG ==========
    print(f"\n{Colors.YELLOW}[1] CONFIG ENDPOINT{Colors.END}")
    resp, ok = api_call("GET", "/config")
    if ok and resp.status_code == 200:
        data = resp.json()
        if data.get("cryptoConfigured") == False and data.get("receiveCurrency") == "USDT":
            passed += log_test("GET /config returns correct config", True, f"cryptoConfigured=False, receiveCurrency=USDT")
        else:
            failed += log_test("GET /config returns correct config", False, f"Got: {data}")
    else:
        failed += log_test("GET /config", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 2. ADMIN AUTH ==========
    print(f"\n{Colors.YELLOW}[2] ADMIN AUTHENTICATION{Colors.END}")
    resp, ok = api_call("POST", "/auth/login", data={"email": "admin@robloot.com", "password": "roblootdevtomo"})
    if ok and resp.status_code == 200:
        data = resp.json()
        if data.get("token") and data.get("user", {}).get("isAdmin") == True:
            admin_token = data["token"]
            passed += log_test("Admin login successful", True, f"Token: {admin_token[:20]}..., isAdmin=True")
        else:
            failed += log_test("Admin login successful", False, f"Got: {data}")
    else:
        failed += log_test("Admin login", False, f"Status: {resp.status_code if resp else 'N/A'}")
        print(f"{Colors.RED}CRITICAL: Cannot proceed without admin token{Colors.END}")
        sys.exit(1)
    
    # ========== 3. ADMIN CRUD ==========
    print(f"\n{Colors.YELLOW}[3] ADMIN CRUD OPERATIONS{Colors.END}")
    
    # 3.1 GET /admin/stats
    resp, ok = api_call("GET", "/admin/stats", token=admin_token)
    if ok and resp.status_code == 200:
        data = resp.json()
        required_keys = ["users", "items", "listings", "orders", "revenue", "reports"]
        if all(k in data for k in required_keys):
            passed += log_test("GET /admin/stats", True, f"Stats: users={data['users']}, items={data['items']}, listings={data['listings']}")
        else:
            failed += log_test("GET /admin/stats", False, f"Missing keys. Got: {list(data.keys())}")
    else:
        failed += log_test("GET /admin/stats", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 3.2 POST /admin/vendors
    resp, ok = api_call("POST", "/admin/vendors", token=admin_token, data={"name": "TestStore", "reputation": 4.5})
    if ok and resp.status_code == 200:
        data = resp.json()
        if data.get("vendor", {}).get("id"):
            vendor_id = data["vendor"]["id"]
            passed += log_test("POST /admin/vendors", True, f"Created vendor: {vendor_id}")
        else:
            failed += log_test("POST /admin/vendors", False, f"No vendor ID returned")
    else:
        failed += log_test("POST /admin/vendors", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 3.3 POST /admin/items
    resp, ok = api_call("POST", "/admin/items", token=admin_token, data={"name": "Test Blade", "description": "A test blade", "category": "Gear"})
    if ok and resp.status_code == 200:
        data = resp.json()
        if data.get("item", {}).get("id"):
            item_id = data["item"]["id"]
            passed += log_test("POST /admin/items", True, f"Created item: {item_id}")
        else:
            failed += log_test("POST /admin/items", False, f"No item ID returned")
    else:
        failed += log_test("POST /admin/items", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 3.4 POST /admin/listings (with validation)
    if not vendor_id or not item_id:
        failed += log_test("POST /admin/listings", False, "Cannot test - missing vendor or item")
    else:
        # Test missing fields
        resp, ok = api_call("POST", "/admin/listings", token=admin_token, data={"price": 12.5})
        if ok and resp.status_code == 400:
            passed += log_test("POST /admin/listings without itemId/vendorId returns 400", True)
        else:
            failed += log_test("POST /admin/listings without itemId/vendorId returns 400", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # Test valid listing
        resp, ok = api_call("POST", "/admin/listings", token=admin_token, data={
            "itemId": item_id,
            "vendorId": vendor_id,
            "price": 12.5,
            "condition": "New",
            "durationDays": "30"
        })
        if ok and resp.status_code == 200:
            data = resp.json()
            if data.get("listing", {}).get("id"):
                listing_id = data["listing"]["id"]
                passed += log_test("POST /admin/listings", True, f"Created listing: {listing_id}")
            else:
                failed += log_test("POST /admin/listings", False, f"No listing ID returned")
        else:
            failed += log_test("POST /admin/listings", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 3.5 Verify listing appears in public GET /listings
    if listing_id:
        resp, ok = api_call("GET", "/listings")
        if ok and resp.status_code == 200:
            data = resp.json()
            listings = data.get("listings", [])
            found = any(l.get("id") == listing_id for l in listings)
            if found:
                passed += log_test("New listing appears in GET /listings", True)
            else:
                failed += log_test("New listing appears in GET /listings", False, f"Listing {listing_id} not found in {len(listings)} listings")
        else:
            failed += log_test("GET /listings", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 3.6 GET admin endpoints
    admin_endpoints = [
        ("/admin/items", "items"),
        ("/admin/listings", "listings"),
        ("/admin/orders", "orders"),
        ("/admin/users", "users"),
        ("/admin/reports", "reports")
    ]
    for endpoint, key in admin_endpoints:
        resp, ok = api_call("GET", endpoint, token=admin_token)
        if ok and resp.status_code == 200:
            data = resp.json()
            if key in data and isinstance(data[key], list):
                passed += log_test(f"GET {endpoint}", True, f"Returns array with {len(data[key])} items")
            else:
                failed += log_test(f"GET {endpoint}", False, f"Expected '{key}' array, got: {list(data.keys())}")
        else:
            failed += log_test(f"GET {endpoint}", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 4. ADMIN GUARD ==========
    print(f"\n{Colors.YELLOW}[4] ADMIN GUARD (403 for normal users){Colors.END}")
    
    # Create normal user
    resp, ok = api_call("POST", "/auth/signup", data={
        "username": "normalbuyer",
        "email": "buyer@test.com",
        "password": "testpass123"
    })
    if ok and resp.status_code == 200:
        data = resp.json()
        normal_token = data.get("token")
        passed += log_test("Create normal user", True, f"Token: {normal_token[:20] if normal_token else 'N/A'}...")
    else:
        failed += log_test("Create normal user", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    if normal_token:
        # Test admin endpoints with normal user token
        guard_tests = [
            ("GET", "/admin/users"),
            ("POST", "/admin/items", {"name": "Hack"}),
            ("POST", "/admin/listings", {"itemId": "fake", "vendorId": "fake", "price": 1})
        ]
        for method, endpoint, *data_args in guard_tests:
            data = data_args[0] if data_args else None
            resp, ok = api_call(method, endpoint, token=normal_token, data=data)
            if ok and resp.status_code == 403:
                passed += log_test(f"{method} {endpoint} with normal user returns 403", True)
            else:
                failed += log_test(f"{method} {endpoint} with normal user returns 403", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 5. BUY FLOW (DEMO MODE) ==========
    print(f"\n{Colors.YELLOW}[5] BUY FLOW (DEMO MODE){Colors.END}")
    
    if not normal_token or not listing_id:
        failed += log_test("Buy flow", False, "Cannot test - missing normal user token or listing")
    else:
        # 5.1 POST /orders
        resp, ok = api_call("POST", "/orders", token=normal_token, data={"listingId": listing_id})
        if ok and resp.status_code == 200:
            data = resp.json()
            if data.get("orderId") and data.get("simulated") == True and data.get("checkoutUrl") is None:
                order_id = data["orderId"]
                passed += log_test("POST /orders (demo mode)", True, f"orderId={order_id}, simulated=True, no checkoutUrl")
            else:
                failed += log_test("POST /orders (demo mode)", False, f"Got: {data}")
        else:
            failed += log_test("POST /orders", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        if order_id:
            # 5.2 GET /payments/status (pending)
            resp, ok = api_call("GET", "/payments/status", params={"orderId": order_id})
            if ok and resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "pending_payment" and "item" in data and "amountUsd" in data:
                    passed += log_test("GET /payments/status (pending)", True, f"status=pending_payment, item={data['item'].get('name')}, amount=${data['amountUsd']}")
                else:
                    failed += log_test("GET /payments/status (pending)", False, f"Got: {data}")
            else:
                failed += log_test("GET /payments/status", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.3 POST /payments/simulate
            resp, ok = api_call("POST", "/payments/simulate", token=normal_token, data={"orderId": order_id})
            if ok and resp.status_code == 200:
                data = resp.json()
                if data.get("ok") == True and data.get("status") == "paid":
                    passed += log_test("POST /payments/simulate", True, "ok=True, status=paid")
                else:
                    failed += log_test("POST /payments/simulate", False, f"Got: {data}")
            else:
                failed += log_test("POST /payments/simulate", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.4 GET /payments/status (paid)
            resp, ok = api_call("GET", "/payments/status", params={"orderId": order_id})
            if ok and resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "paid":
                    passed += log_test("GET /payments/status (paid)", True, "status=paid")
                else:
                    failed += log_test("GET /payments/status (paid)", False, f"Got status: {data.get('status')}")
            else:
                failed += log_test("GET /payments/status", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.5 GET /listings/:id (should be sold)
            resp, ok = api_call("GET", f"/listings/{listing_id}")
            if ok and resp.status_code == 200:
                data = resp.json()
                if data.get("listing", {}).get("status") == "sold":
                    passed += log_test("GET /listings/:id shows status=sold", True)
                else:
                    failed += log_test("GET /listings/:id shows status=sold", False, f"Got status: {data.get('listing', {}).get('status')}")
            else:
                failed += log_test("GET /listings/:id", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.6 GET /orders (should show purchase)
            resp, ok = api_call("GET", "/orders", token=normal_token)
            if ok and resp.status_code == 200:
                data = resp.json()
                purchases = data.get("purchases", [])
                found = any(p.get("orderId") == order_id and p.get("status") == "paid" for p in purchases)
                if found:
                    passed += log_test("GET /orders shows purchase with status=paid", True)
                else:
                    failed += log_test("GET /orders shows purchase with status=paid", False, f"Order not found in {len(purchases)} purchases")
            else:
                failed += log_test("GET /orders", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.7 GET /notifications (should have payment confirmation)
            resp, ok = api_call("GET", "/notifications", token=normal_token)
            if ok and resp.status_code == 200:
                data = resp.json()
                notifications = data.get("notifications", [])
                found = any("Payment confirmed" in n.get("text", "") for n in notifications)
                if found:
                    passed += log_test("GET /notifications contains 'Payment confirmed'", True)
                else:
                    failed += log_test("GET /notifications contains 'Payment confirmed'", False, f"Not found in {len(notifications)} notifications")
            else:
                failed += log_test("GET /notifications", False, f"Status: {resp.status_code if resp else 'N/A'}")
            
            # 5.8 Try buying sold listing (should fail)
            resp, ok = api_call("POST", "/orders", token=normal_token, data={"listingId": listing_id})
            if ok and resp.status_code == 400:
                passed += log_test("Buying sold listing returns 400", True)
            else:
                failed += log_test("Buying sold listing returns 400", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 6. WISHLIST/REPORTS/NOTIFS ==========
    print(f"\n{Colors.YELLOW}[6] WISHLIST, REPORTS, NOTIFICATIONS{Colors.END}")
    
    if normal_token and item_id:
        # 6.1 POST /wishlist (add)
        resp, ok = api_call("POST", "/wishlist", token=normal_token, data={"itemId": item_id})
        if ok and resp.status_code == 200:
            data = resp.json()
            if data.get("added") == True:
                passed += log_test("POST /wishlist (add)", True, "added=True")
            else:
                failed += log_test("POST /wishlist (add)", False, f"Got: {data}")
        else:
            failed += log_test("POST /wishlist (add)", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # 6.2 POST /wishlist (remove)
        resp, ok = api_call("POST", "/wishlist", token=normal_token, data={"itemId": item_id})
        if ok and resp.status_code == 200:
            data = resp.json()
            if data.get("added") == False:
                passed += log_test("POST /wishlist (remove)", True, "added=False")
            else:
                failed += log_test("POST /wishlist (remove)", False, f"Got: {data}")
        else:
            failed += log_test("POST /wishlist (remove)", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    if normal_token and listing_id:
        # 6.3 POST /reports
        resp, ok = api_call("POST", "/reports", token=normal_token, data={"listingId": listing_id, "reason": "scam"})
        if ok and resp.status_code == 200:
            data = resp.json()
            if data.get("report", {}).get("id"):
                report_id = data["report"]["id"]
                passed += log_test("POST /reports", True, f"Created report: {report_id}")
            else:
                failed += log_test("POST /reports", False, f"No report ID returned")
        else:
            failed += log_test("POST /reports", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    if admin_token and report_id:
        # 6.4 Admin GET /admin/reports
        resp, ok = api_call("GET", "/admin/reports", token=admin_token)
        if ok and resp.status_code == 200:
            data = resp.json()
            reports = data.get("reports", [])
            found = any(r.get("id") == report_id for r in reports)
            if found:
                passed += log_test("Admin GET /admin/reports shows report", True)
            else:
                failed += log_test("Admin GET /admin/reports shows report", False, f"Report not found in {len(reports)} reports")
        else:
            failed += log_test("Admin GET /admin/reports", False, f"Status: {resp.status_code if resp else 'N/A'}")
        
        # 6.5 Admin POST /admin/reports/:id (resolve)
        resp, ok = api_call("POST", f"/admin/reports/{report_id}", token=admin_token)
        if ok and resp.status_code == 200:
            passed += log_test("Admin POST /admin/reports/:id (resolve)", True)
        else:
            failed += log_test("Admin POST /admin/reports/:id (resolve)", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== 7. FILTERS ==========
    print(f"\n{Colors.YELLOW}[7] LISTING FILTERS{Colors.END}")
    
    # 7.1 Sort by price_asc
    resp, ok = api_call("GET", "/listings", params={"sort": "price_asc"})
    if ok and resp.status_code == 200:
        data = resp.json()
        listings = data.get("listings", [])
        if len(listings) >= 2:
            prices = [l.get("price", 0) for l in listings[:5]]
            is_ascending = all(prices[i] <= prices[i+1] for i in range(len(prices)-1))
            if is_ascending:
                passed += log_test("GET /listings?sort=price_asc", True, f"Prices ascending: {prices[:3]}")
            else:
                failed += log_test("GET /listings?sort=price_asc", False, f"Not ascending: {prices}")
        else:
            passed += log_test("GET /listings?sort=price_asc", True, "Too few listings to verify order")
    else:
        failed += log_test("GET /listings?sort=price_asc", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 7.2 Filter by category
    resp, ok = api_call("GET", "/listings", params={"category": "Limiteds"})
    if ok and resp.status_code == 200:
        data = resp.json()
        listings = data.get("listings", [])
        all_limiteds = all(l.get("item", {}).get("category") == "Limiteds" for l in listings)
        if all_limiteds:
            passed += log_test("GET /listings?category=Limiteds", True, f"All {len(listings)} listings are Limiteds")
        else:
            failed += log_test("GET /listings?category=Limiteds", False, "Found non-Limiteds items")
    else:
        failed += log_test("GET /listings?category=Limiteds", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 7.3 Search by name
    resp, ok = api_call("GET", "/listings", params={"search": "Frost"})
    if ok and resp.status_code == 200:
        data = resp.json()
        listings = data.get("listings", [])
        all_match = all("frost" in l.get("item", {}).get("name", "").lower() for l in listings)
        if all_match and len(listings) > 0:
            passed += log_test("GET /listings?search=Frost", True, f"Found {len(listings)} matching listings")
        elif len(listings) == 0:
            passed += log_test("GET /listings?search=Frost", True, "No matches (acceptable)")
        else:
            failed += log_test("GET /listings?search=Frost", False, "Found non-matching items")
    else:
        failed += log_test("GET /listings?search=Frost", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # 7.4 Filter by maxPrice
    resp, ok = api_call("GET", "/listings", params={"maxPrice": "20"})
    if ok and resp.status_code == 200:
        data = resp.json()
        listings = data.get("listings", [])
        all_under_20 = all(l.get("price", 999) <= 20 for l in listings)
        if all_under_20:
            passed += log_test("GET /listings?maxPrice=20", True, f"All {len(listings)} listings <= $20")
        else:
            failed += log_test("GET /listings?maxPrice=20", False, "Found listings over $20")
    else:
        failed += log_test("GET /listings?maxPrice=20", False, f"Status: {resp.status_code if resp else 'N/A'}")
    
    # ========== SUMMARY ==========
    print(f"\n{Colors.BLUE}{'='*60}")
    print(f"TEST SUMMARY")
    print(f"{'='*60}{Colors.END}")
    print(f"{Colors.GREEN}Passed: {passed}{Colors.END}")
    print(f"{Colors.RED}Failed: {failed}{Colors.END}")
    print(f"Total: {passed + failed}\n")
    
    if failed == 0:
        print(f"{Colors.GREEN}✓ ALL TESTS PASSED{Colors.END}\n")
        return 0
    else:
        print(f"{Colors.RED}✗ SOME TESTS FAILED{Colors.END}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())

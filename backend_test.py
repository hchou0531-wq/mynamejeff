#!/usr/bin/env python3
"""
Backend API Testing for UPDATE 13 - Robloot
Tests: Trades eligibility fix, multi-source sales/reviews, eBay import, admin guards
"""

import requests
import json
import sys
from typing import Dict, Any

# Configuration
BASE_URL = "https://git-preview-roblox.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@robloot.com"
ADMIN_PASSWORD = "roblootdevtomo"

# Test results tracking
tests_passed = 0
tests_failed = 0
test_results = []

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✓ PASSED: {name}")
        if details:
            print(f"  Details: {details}")
    else:
        tests_failed += 1
        print(f"✗ FAILED: {name}")
        if details:
            print(f"  Details: {details}")
    test_results.append({"name": name, "passed": passed, "details": details})

def admin_login() -> str:
    """Login as admin and return token"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30
        )
        if response.status_code == 200:
            data = response.json()
            token = data.get("token")
            is_admin = data.get("user", {}).get("isAdmin", False)
            if token and is_admin:
                print(f"✓ Admin login successful, token: {token[:20]}...")
                return token
            else:
                print(f"✗ Admin login failed: user is not admin")
                return None
        else:
            print(f"✗ Admin login failed: HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Admin login exception: {e}")
        return None

def normal_user_signup() -> str:
    """Signup a normal user and return token"""
    import random
    username = f"testuser{random.randint(10000, 99999)}"
    email = f"{username}@test.com"
    try:
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"username": username, "email": email, "password": "testpass123"},
            timeout=30
        )
        if response.status_code == 200:
            data = response.json()
            token = data.get("token")
            print(f"✓ Normal user signup successful: {username}, token: {token[:20]}...")
            return token
        else:
            print(f"✗ Normal user signup failed: HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Normal user signup exception: {e}")
        return None

# ============================================================================
# TEST 1: TRADES LIVE CHECK (main fix)
# ============================================================================
def test_trades_eligibility():
    """Test GET /api/checkout/eligibility with different userIds"""
    print("\n" + "="*80)
    print("TEST 1: TRADES LIVE CHECK (main fix)")
    print("="*80)
    
    # Test 1.1: userId=156 (builderman) - should have tradesChecked=true, tradesEnabled=false, tradeStatus='ReceiverCannotTrade'
    print("\n[1.1] Testing userId=156 (builderman)...")
    try:
        response = requests.get(f"{BASE_URL}/checkout/eligibility?userId=156", timeout=30)
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            eligibility = data.get("eligibility", {})
            
            # Check all required fields
            trades_checked = eligibility.get("tradesChecked")
            trades_enabled = eligibility.get("tradesEnabled")
            trade_status = eligibility.get("tradeStatus")
            premium_checked = eligibility.get("premiumChecked")
            premium = eligibility.get("premium")
            
            print(f"  tradesChecked: {trades_checked}")
            print(f"  tradesEnabled: {trades_enabled}")
            print(f"  tradeStatus: {trade_status}")
            print(f"  premiumChecked: {premium_checked}")
            print(f"  premium: {premium}")
            
            # CRITICAL: tradesChecked must be true (not false)
            if trades_checked == True:
                log_test("userId=156: tradesChecked === true", True, f"tradesChecked={trades_checked}")
            else:
                log_test("userId=156: tradesChecked === true", False, f"Expected true, got {trades_checked}")
            
            # tradesEnabled should be false
            if trades_enabled == False:
                log_test("userId=156: tradesEnabled === false", True, f"tradesEnabled={trades_enabled}")
            else:
                log_test("userId=156: tradesEnabled === false", False, f"Expected false, got {trades_enabled}")
            
            # tradeStatus should be 'ReceiverCannotTrade'
            if trade_status == 'ReceiverCannotTrade':
                log_test("userId=156: tradeStatus === 'ReceiverCannotTrade'", True, f"tradeStatus={trade_status}")
            else:
                log_test("userId=156: tradeStatus === 'ReceiverCannotTrade'", False, f"Expected 'ReceiverCannotTrade', got {trade_status}")
            
            # premiumChecked should be true
            if premium_checked == True:
                log_test("userId=156: premiumChecked === true", True, f"premiumChecked={premium_checked}")
            else:
                log_test("userId=156: premiumChecked === true", False, f"Expected true, got {premium_checked}")
            
            # premium should be true
            if premium == True:
                log_test("userId=156: premium === true", True, f"premium={premium}")
            else:
                log_test("userId=156: premium === true", False, f"Expected true, got {premium}")
            
            # Must NOT be 500
            log_test("userId=156: HTTP 200 (not 500)", True, f"HTTP {response.status_code}")
        else:
            log_test("userId=156: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("userId=156: Request successful", False, f"Exception: {e}")
    
    # Test 1.2: userId=2207291 (Linkmon99) - should have tradesChecked=true, tradesEnabled=true, tradeStatus='CanTrade'
    print("\n[1.2] Testing userId=2207291 (Linkmon99)...")
    try:
        response = requests.get(f"{BASE_URL}/checkout/eligibility?userId=2207291", timeout=30)
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            eligibility = data.get("eligibility", {})
            
            trades_checked = eligibility.get("tradesChecked")
            trades_enabled = eligibility.get("tradesEnabled")
            trade_status = eligibility.get("tradeStatus")
            
            print(f"  tradesChecked: {trades_checked}")
            print(f"  tradesEnabled: {trades_enabled}")
            print(f"  tradeStatus: {trade_status}")
            
            # tradesChecked must be true
            if trades_checked == True:
                log_test("userId=2207291: tradesChecked === true", True, f"tradesChecked={trades_checked}")
            else:
                log_test("userId=2207291: tradesChecked === true", False, f"Expected true, got {trades_checked}")
            
            # tradesEnabled should be true
            if trades_enabled == True:
                log_test("userId=2207291: tradesEnabled === true", True, f"tradesEnabled={trades_enabled}")
            else:
                log_test("userId=2207291: tradesEnabled === true", False, f"Expected true, got {trades_enabled}")
            
            # tradeStatus should be 'CanTrade'
            if trade_status == 'CanTrade':
                log_test("userId=2207291: tradeStatus === 'CanTrade'", True, f"tradeStatus={trade_status}")
            else:
                log_test("userId=2207291: tradeStatus === 'CanTrade'", False, f"Expected 'CanTrade', got {trade_status}")
            
            log_test("userId=2207291: HTTP 200", True, f"HTTP {response.status_code}")
        else:
            log_test("userId=2207291: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("userId=2207291: Request successful", False, f"Exception: {e}")
    
    # Test 1.3: userId=999999999999 (nonexistent) - must NOT 500 (200 or 502 acceptable)
    print("\n[1.3] Testing userId=999999999999 (nonexistent)...")
    try:
        response = requests.get(f"{BASE_URL}/checkout/eligibility?userId=999999999999", timeout=30)
        print(f"Response status: {response.status_code}")
        
        if response.status_code in [200, 502]:
            log_test("userId=999999999999: NOT 500", True, f"HTTP {response.status_code} (acceptable)")
        else:
            log_test("userId=999999999999: NOT 500", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("userId=999999999999: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 2: MULTI-SOURCE SALES
# ============================================================================
def test_multi_source_sales(admin_token: str):
    """Test POST /api/admin/reviews/settings with salesBySource"""
    print("\n" + "="*80)
    print("TEST 2: MULTI-SOURCE SALES")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    # Test 2.1: Set salesBySource with all sources
    print("\n[2.1] Testing POST /api/admin/reviews/settings with salesBySource object...")
    try:
        payload = {
            "salesBySource": {
                "ebay": 10,
                "eldorado": 40,
                "sellauth": 25,
                "other": 0
            }
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews/settings",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            total_sales = data.get("totalSales")
            sales_by_source = data.get("salesBySource", {})
            
            print(f"  totalSales: {total_sales}")
            print(f"  salesBySource: {sales_by_source}")
            
            # totalSales should be 75 (10+40+25+0)
            if total_sales == 75:
                log_test("salesBySource: totalSales === 75", True, f"totalSales={total_sales}")
            else:
                log_test("salesBySource: totalSales === 75", False, f"Expected 75, got {total_sales}")
            
            # salesBySource should match
            if (sales_by_source.get("ebay") == 10 and 
                sales_by_source.get("eldorado") == 40 and 
                sales_by_source.get("sellauth") == 25 and 
                sales_by_source.get("other") == 0):
                log_test("salesBySource: values match", True, f"ebay=10, eldorado=40, sellauth=25, other=0")
            else:
                log_test("salesBySource: values match", False, f"Got {sales_by_source}")
            
            # Verify via GET /api/reviews
            print("\n  Verifying via GET /api/reviews...")
            get_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
            if get_response.status_code == 200:
                get_data = get_response.json()
                get_total = get_data.get("totalSales")
                get_sbs = get_data.get("salesBySource", {})
                
                print(f"  GET totalSales: {get_total}")
                print(f"  GET salesBySource: {get_sbs}")
                
                if get_total == 75:
                    log_test("GET /api/reviews: totalSales === 75", True, f"totalSales={get_total}")
                else:
                    log_test("GET /api/reviews: totalSales === 75", False, f"Expected 75, got {get_total}")
                
                if (get_sbs.get("ebay") == 10 and 
                    get_sbs.get("eldorado") == 40 and 
                    get_sbs.get("sellauth") == 25 and 
                    get_sbs.get("other") == 0):
                    log_test("GET /api/reviews: salesBySource matches", True, "All sources match")
                else:
                    log_test("GET /api/reviews: salesBySource matches", False, f"Got {get_sbs}")
            else:
                log_test("GET /api/reviews: HTTP 200", False, f"Got HTTP {get_response.status_code}")
        else:
            log_test("POST salesBySource: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("POST salesBySource: Request successful", False, f"Exception: {e}")
    
    # Test 2.2: Update individual source (eldorado)
    print("\n[2.2] Testing POST /api/admin/reviews/settings with individual source update...")
    try:
        payload = {
            "source": "eldorado",
            "sales": 100
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews/settings",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"  Response: {data}")
            
            # Verify via GET /api/reviews
            print("\n  Verifying via GET /api/reviews...")
            get_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
            if get_response.status_code == 200:
                get_data = get_response.json()
                get_sbs = get_data.get("salesBySource", {})
                get_total = get_data.get("totalSales")
                
                print(f"  GET salesBySource: {get_sbs}")
                print(f"  GET totalSales: {get_total}")
                
                # eldorado should be 100
                if get_sbs.get("eldorado") == 100:
                    log_test("Individual source update: eldorado === 100", True, f"eldorado={get_sbs.get('eldorado')}")
                else:
                    log_test("Individual source update: eldorado === 100", False, f"Expected 100, got {get_sbs.get('eldorado')}")
                
                # ebay should still be 10
                if get_sbs.get("ebay") == 10:
                    log_test("Individual source update: ebay still 10", True, f"ebay={get_sbs.get('ebay')}")
                else:
                    log_test("Individual source update: ebay still 10", False, f"Expected 10, got {get_sbs.get('ebay')}")
                
                # sellauth should still be 25
                if get_sbs.get("sellauth") == 25:
                    log_test("Individual source update: sellauth still 25", True, f"sellauth={get_sbs.get('sellauth')}")
                else:
                    log_test("Individual source update: sellauth still 25", False, f"Expected 25, got {get_sbs.get('sellauth')}")
                
                # totalSales should be 135 (10+100+25+0)
                if get_total == 135:
                    log_test("Individual source update: totalSales === 135", True, f"totalSales={get_total}")
                else:
                    log_test("Individual source update: totalSales === 135", False, f"Expected 135, got {get_total}")
            else:
                log_test("GET /api/reviews after update: HTTP 200", False, f"Got HTTP {get_response.status_code}")
        else:
            log_test("POST individual source: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("POST individual source: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 3: MULTI-SOURCE REVIEW
# ============================================================================
def test_multi_source_review(admin_token: str):
    """Test POST /api/admin/reviews with source field"""
    print("\n" + "="*80)
    print("TEST 3: MULTI-SOURCE REVIEW")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    # Test 3.1: Create review with source='eldorado'
    print("\n[3.1] Testing POST /api/admin/reviews with source='eldorado'...")
    try:
        payload = {
            "author": "e***o",
            "comment": "Great Eldorado deal",
            "rating": "positive",
            "source": "eldorado"
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            review = data.get("review", {})
            print(f"  Created review: {review.get('id')}")
            
            log_test("Create review with source='eldorado': HTTP 200", True, f"Review created")
            
            # Verify via GET /api/reviews
            print("\n  Verifying via GET /api/reviews...")
            get_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
            if get_response.status_code == 200:
                get_data = get_response.json()
                reviews = get_data.get("reviews", [])
                
                # Find the review with source='eldorado'
                eldorado_reviews = [r for r in reviews if r.get("source") == "eldorado"]
                
                if len(eldorado_reviews) > 0:
                    log_test("GET /api/reviews: includes review with source='eldorado'", True, f"Found {len(eldorado_reviews)} eldorado review(s)")
                else:
                    log_test("GET /api/reviews: includes review with source='eldorado'", False, "No eldorado reviews found")
            else:
                log_test("GET /api/reviews: HTTP 200", False, f"Got HTTP {get_response.status_code}")
        else:
            log_test("Create review with source='eldorado': HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("Create review with source='eldorado': Request successful", False, f"Exception: {e}")
    
    # Test 3.2: Create review without source (should default)
    print("\n[3.2] Testing POST /api/admin/reviews without source (should default)...")
    try:
        payload = {
            "comment": "no source given"
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            review = data.get("review", {})
            source = review.get("source")
            print(f"  Created review with source: {source}")
            
            log_test("Create review without source: HTTP 200", True, f"Review created with source={source}")
        else:
            log_test("Create review without source: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("Create review without source: Request successful", False, f"Exception: {e}")
    
    # Test 3.3: Create review without comment (should fail with 400)
    print("\n[3.3] Testing POST /api/admin/reviews without comment (should fail)...")
    try:
        payload = {
            "author": "x"
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 400:
            log_test("Create review without comment: HTTP 400", True, "Correctly rejected")
        else:
            log_test("Create review without comment: HTTP 400", False, f"Expected 400, got {response.status_code}")
    except Exception as e:
        log_test("Create review without comment: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 4: eBay IMPORT
# ============================================================================
def test_ebay_import(admin_token: str):
    """Test POST /api/admin/reviews/import-ebay"""
    print("\n" + "="*80)
    print("TEST 4: eBay IMPORT")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    # Test 4.1: Import from valid eBay URL
    print("\n[4.1] Testing POST /api/admin/reviews/import-ebay with valid URL...")
    try:
        payload = {
            "url": "https://www.ebay.com/fdbk/feedback_profile/bloxifier?filter=feedback_page%3ARECEIVED_AS_SELLER&sort=RELEVANCEV2",
            "setTotalSales": True
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews/import-ebay",
            json=payload,
            headers=headers,
            timeout=45
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            detected = data.get("detected", 0)
            feedback_score = data.get("feedbackScore")
            imported = data.get("imported", 0)
            skipped = data.get("skipped", 0)
            
            print(f"  detected: {detected}")
            print(f"  feedbackScore: {feedback_score}")
            print(f"  imported: {imported}")
            print(f"  skipped: {skipped}")
            
            # detected should be >= 1 (unless eBay rate-limited)
            if detected >= 1:
                log_test("eBay import: detected >= 1", True, f"detected={detected}")
            else:
                log_test("eBay import: detected >= 1", False, f"detected={detected} (Note: eBay may rate-limit, not necessarily a code failure)")
            
            # feedbackScore should be a number
            if isinstance(feedback_score, (int, float)):
                log_test("eBay import: feedbackScore is number", True, f"feedbackScore={feedback_score}")
            else:
                log_test("eBay import: feedbackScore is number", False, f"feedbackScore={feedback_score}")
            
            # imported should be a number
            if isinstance(imported, int):
                log_test("eBay import: imported is number", True, f"imported={imported}")
            else:
                log_test("eBay import: imported is number", False, f"imported={imported}")
            
            # skipped should be a number
            if isinstance(skipped, int):
                log_test("eBay import: skipped is number", True, f"skipped={skipped}")
            else:
                log_test("eBay import: skipped is number", False, f"skipped={skipped}")
            
            # Verify salesBySource.ebay equals feedbackScore
            if feedback_score is not None:
                print("\n  Verifying salesBySource.ebay via GET /api/reviews...")
                get_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
                if get_response.status_code == 200:
                    get_data = get_response.json()
                    sbs = get_data.get("salesBySource", {})
                    ebay_sales = sbs.get("ebay")
                    
                    print(f"  salesBySource.ebay: {ebay_sales}")
                    
                    if ebay_sales == feedback_score:
                        log_test("eBay import: salesBySource.ebay === feedbackScore", True, f"ebay={ebay_sales}, feedbackScore={feedback_score}")
                    else:
                        log_test("eBay import: salesBySource.ebay === feedbackScore", False, f"Expected {feedback_score}, got {ebay_sales}")
                else:
                    log_test("GET /api/reviews after import: HTTP 200", False, f"Got HTTP {get_response.status_code}")
            
            log_test("eBay import: HTTP 200", True, "Import successful")
        else:
            log_test("eBay import: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("eBay import: Request successful", False, f"Exception: {e}")
    
    # Test 4.2: Import from invalid URL (should fail with 400)
    print("\n[4.2] Testing POST /api/admin/reviews/import-ebay with invalid URL...")
    try:
        payload = {
            "url": "https://www.google.com"
        }
        response = requests.post(
            f"{BASE_URL}/admin/reviews/import-ebay",
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 400:
            log_test("eBay import invalid URL: HTTP 400", True, "Correctly rejected")
        else:
            log_test("eBay import invalid URL: HTTP 400", False, f"Expected 400, got {response.status_code}")
    except Exception as e:
        log_test("eBay import invalid URL: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 5: ADMIN GUARD
# ============================================================================
def test_admin_guard(normal_token: str):
    """Test that non-admin users get 403 on admin endpoints"""
    print("\n" + "="*80)
    print("TEST 5: ADMIN GUARD")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {normal_token}"}
    
    # Test 5.1: POST /api/admin/reviews/settings
    print("\n[5.1] Testing POST /api/admin/reviews/settings as non-admin...")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/reviews/settings",
            json={"totalSales": 100},
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("Non-admin POST /admin/reviews/settings: HTTP 403", True, "Correctly blocked")
        else:
            log_test("Non-admin POST /admin/reviews/settings: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("Non-admin POST /admin/reviews/settings: Request successful", False, f"Exception: {e}")
    
    # Test 5.2: POST /api/admin/reviews
    print("\n[5.2] Testing POST /api/admin/reviews as non-admin...")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/reviews",
            json={"comment": "test"},
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("Non-admin POST /admin/reviews: HTTP 403", True, "Correctly blocked")
        else:
            log_test("Non-admin POST /admin/reviews: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("Non-admin POST /admin/reviews: Request successful", False, f"Exception: {e}")
    
    # Test 5.3: POST /api/admin/reviews/import-ebay
    print("\n[5.3] Testing POST /api/admin/reviews/import-ebay as non-admin...")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/reviews/import-ebay",
            json={"url": "https://www.ebay.com/fdbk/feedback_profile/test"},
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("Non-admin POST /admin/reviews/import-ebay: HTTP 403", True, "Correctly blocked")
        else:
            log_test("Non-admin POST /admin/reviews/import-ebay: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("Non-admin POST /admin/reviews/import-ebay: Request successful", False, f"Exception: {e}")
    
    # Test 5.4: DELETE /api/admin/reviews/:id
    print("\n[5.4] Testing DELETE /api/admin/reviews/:id as non-admin...")
    try:
        response = requests.delete(
            f"{BASE_URL}/admin/reviews/anyid",
            headers=headers,
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("Non-admin DELETE /admin/reviews/:id: HTTP 403", True, "Correctly blocked")
        else:
            log_test("Non-admin DELETE /admin/reviews/:id: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("Non-admin DELETE /admin/reviews/:id: Request successful", False, f"Exception: {e}")
    
    # Test 5.5: No auth header
    print("\n[5.5] Testing POST /admin/reviews/settings with NO auth header...")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/reviews/settings",
            json={"totalSales": 100},
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("No auth POST /admin/reviews/settings: HTTP 403", True, "Correctly blocked")
        else:
            log_test("No auth POST /admin/reviews/settings: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("No auth POST /admin/reviews/settings: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 6: DELETE REVIEW
# ============================================================================
def test_delete_review(admin_token: str):
    """Test DELETE /api/admin/reviews/:id"""
    print("\n" + "="*80)
    print("TEST 6: DELETE REVIEW")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    # First, get a review ID from GET /api/reviews
    print("\n[6.1] Getting review ID from GET /api/reviews...")
    try:
        get_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
        if get_response.status_code == 200:
            data = get_response.json()
            reviews = data.get("reviews", [])
            
            if len(reviews) > 0:
                review_id = reviews[0].get("id")
                print(f"  Found review ID: {review_id}")
                
                # Delete the review
                print(f"\n[6.2] Deleting review {review_id}...")
                delete_response = requests.delete(
                    f"{BASE_URL}/admin/reviews/{review_id}",
                    headers=headers,
                    timeout=30
                )
                print(f"Response status: {delete_response.status_code}")
                
                if delete_response.status_code == 200:
                    delete_data = delete_response.json()
                    success = delete_data.get("success")
                    
                    if success == True:
                        log_test("DELETE review: success === true", True, f"Review {review_id} deleted")
                    else:
                        log_test("DELETE review: success === true", False, f"success={success}")
                    
                    # Verify review is gone
                    print("\n[6.3] Verifying review is gone...")
                    verify_response = requests.get(f"{BASE_URL}/reviews", timeout=30)
                    if verify_response.status_code == 200:
                        verify_data = verify_response.json()
                        verify_reviews = verify_data.get("reviews", [])
                        
                        # Check if the deleted review is still present
                        deleted_review = next((r for r in verify_reviews if r.get("id") == review_id), None)
                        
                        if deleted_review is None:
                            log_test("DELETE review: review is gone", True, f"Review {review_id} not found in list")
                        else:
                            log_test("DELETE review: review is gone", False, f"Review {review_id} still present")
                    else:
                        log_test("GET /api/reviews after delete: HTTP 200", False, f"Got HTTP {verify_response.status_code}")
                else:
                    log_test("DELETE review: HTTP 200", False, f"Got HTTP {delete_response.status_code}")
            else:
                print("  No reviews found to delete")
                log_test("DELETE review: reviews available", False, "No reviews to delete")
        else:
            log_test("GET /api/reviews: HTTP 200", False, f"Got HTTP {get_response.status_code}")
    except Exception as e:
        log_test("DELETE review: Request successful", False, f"Exception: {e}")

# ============================================================================
# TEST 7: REGRESSION
# ============================================================================
def test_regression():
    """Test regression: GET /api/config and POST /api/payments/simulate"""
    print("\n" + "="*80)
    print("TEST 7: REGRESSION")
    print("="*80)
    
    # Test 7.1: GET /api/config
    print("\n[7.1] Testing GET /api/config...")
    try:
        response = requests.get(f"{BASE_URL}/config", timeout=30)
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            crypto_configured = data.get("cryptoConfigured")
            provider = data.get("provider")
            
            print(f"  cryptoConfigured: {crypto_configured}")
            print(f"  provider: {provider}")
            
            if crypto_configured == True:
                log_test("GET /api/config: cryptoConfigured === true", True, f"cryptoConfigured={crypto_configured}")
            else:
                log_test("GET /api/config: cryptoConfigured === true", False, f"Expected true, got {crypto_configured}")
            
            if provider == "blockbee":
                log_test("GET /api/config: provider === 'blockbee'", True, f"provider={provider}")
            else:
                log_test("GET /api/config: provider === 'blockbee'", False, f"Expected 'blockbee', got {provider}")
        else:
            log_test("GET /api/config: HTTP 200", False, f"Got HTTP {response.status_code}")
    except Exception as e:
        log_test("GET /api/config: Request successful", False, f"Exception: {e}")
    
    # Test 7.2: POST /api/payments/simulate (should return 403)
    print("\n[7.2] Testing POST /api/payments/simulate (should return 403)...")
    try:
        response = requests.post(
            f"{BASE_URL}/payments/simulate",
            json={"orderId": "x"},
            timeout=30
        )
        print(f"Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("POST /api/payments/simulate: HTTP 403", True, "Correctly blocked (crypto configured)")
        else:
            log_test("POST /api/payments/simulate: HTTP 403", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("POST /api/payments/simulate: Request successful", False, f"Exception: {e}")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    """Main test runner"""
    print("\n" + "="*80)
    print("BACKEND TESTING - UPDATE 13")
    print("Robloot - Trades eligibility fix + Multi-source sales/reviews + eBay import")
    print("="*80)
    
    # Test 1: Trades eligibility (no auth required)
    test_trades_eligibility()
    
    # Login as admin
    admin_token = admin_login()
    if not admin_token:
        print("\n✗ CRITICAL: Admin login failed. Cannot continue with admin tests.")
        sys.exit(1)
    
    # Test 2: Multi-source sales
    test_multi_source_sales(admin_token)
    
    # Test 3: Multi-source review
    test_multi_source_review(admin_token)
    
    # Test 4: eBay import
    test_ebay_import(admin_token)
    
    # Signup normal user for admin guard tests
    normal_token = normal_user_signup()
    if not normal_token:
        print("\n✗ WARNING: Normal user signup failed. Skipping admin guard tests.")
    else:
        # Test 5: Admin guard
        test_admin_guard(normal_token)
    
    # Test 6: Delete review
    test_delete_review(admin_token)
    
    # Test 7: Regression
    test_regression()
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {tests_passed + tests_failed}")
    print(f"Passed: {tests_passed}")
    print(f"Failed: {tests_failed}")
    
    if tests_failed == 0:
        print("\n✓ ALL TESTS PASSED")
        return 0
    else:
        print(f"\n✗ {tests_failed} TEST(S) FAILED")
        print("\nFailed tests:")
        for result in test_results:
            if not result["passed"]:
                print(f"  - {result['name']}: {result['details']}")
        return 1

if __name__ == "__main__":
    sys.exit(main())

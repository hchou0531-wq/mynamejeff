#!/usr/bin/env python3
"""
Backend API tests for UPDATE 12: Reviews + eBay import
Tests the Robloot marketplace backend at {NEXT_PUBLIC_BASE_URL}/api
"""
import requests
import sys
import os
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://git-preview-roblox.preview.emergentagent.com')
API_URL = f"{BASE_URL}/api"

# Admin credentials
ADMIN_EMAIL = "admin@robloot.com"
ADMIN_PASSWORD = "roblootdevtomo"

def test_get_reviews_public():
    """Test 1: GET /api/reviews (NO auth) -> HTTP 200 with {totalSales, reviews}"""
    print("\n=== TEST 1: GET /api/reviews (public, no auth) ===")
    try:
        response = requests.get(f"{API_URL}/reviews", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        if 'totalSales' not in data:
            print(f"❌ FAILED: Missing 'totalSales' key in response")
            print(f"Response: {data}")
            return False
        
        if 'reviews' not in data:
            print(f"❌ FAILED: Missing 'reviews' key in response")
            print(f"Response: {data}")
            return False
        
        if not isinstance(data['totalSales'], (int, float)):
            print(f"❌ FAILED: totalSales should be number, got {type(data['totalSales'])}")
            return False
        
        if not isinstance(data['reviews'], list):
            print(f"❌ FAILED: reviews should be array, got {type(data['reviews'])}")
            return False
        
        print(f"✓ totalSales: {data['totalSales']}")
        print(f"✓ reviews count: {len(data['reviews'])}")
        print("✅ PASSED: GET /api/reviews returns HTTP 200 with totalSales and reviews array")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_admin_reviews_settings():
    """Test 2: POST /api/admin/reviews/settings with {totalSales:1234} as admin"""
    print("\n=== TEST 2: POST /api/admin/reviews/settings ===")
    try:
        # Admin login
        print("Step (a): Admin login...")
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        if login_response.status_code != 200:
            print(f"❌ FAILED: Admin login failed with status {login_response.status_code}")
            return False
        
        admin_token = login_response.json()['token']
        print(f"✓ Admin login successful")
        
        # Set totalSales
        print("Step (b): POST /api/admin/reviews/settings with totalSales=1234...")
        response = requests.post(f"{API_URL}/admin/reviews/settings",
                                json={"totalSales": 1234},
                                headers={"Authorization": f"Bearer {admin_token}"},
                                timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response: {data}")
        
        if data.get('success') != True:
            print(f"❌ FAILED: Expected success=true, got {data.get('success')}")
            return False
        
        if data.get('totalSales') != 1234:
            print(f"❌ FAILED: Expected totalSales=1234, got {data.get('totalSales')}")
            return False
        
        print(f"✓ success: {data['success']}")
        print(f"✓ totalSales: {data['totalSales']}")
        
        # Verify with GET /api/reviews
        print("Step (c): Verify with GET /api/reviews...")
        get_response = requests.get(f"{API_URL}/reviews", timeout=30)
        
        if get_response.status_code != 200:
            print(f"❌ FAILED: GET /api/reviews failed with status {get_response.status_code}")
            return False
        
        get_data = get_response.json()
        
        if get_data.get('totalSales') != 1234:
            print(f"❌ FAILED: GET /api/reviews totalSales should be 1234, got {get_data.get('totalSales')}")
            return False
        
        print(f"✓ GET /api/reviews totalSales === 1234")
        print("✅ PASSED: Admin can set totalSales and it persists")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_admin_create_review():
    """Test 3: POST /api/admin/reviews with review data as admin"""
    print("\n=== TEST 3: POST /api/admin/reviews (create manual review) ===")
    try:
        # Admin login
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        # Create review
        print("Step (a): POST /api/admin/reviews with valid data...")
        review_data = {
            "author": "j***n",
            "comment": "Great seller, fast delivery",
            "rating": "positive",
            "item": "Test Item"
        }
        response = requests.post(f"{API_URL}/admin/reviews",
                                json=review_data,
                                headers={"Authorization": f"Bearer {admin_token}"},
                                timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        if 'review' not in data:
            print(f"❌ FAILED: Missing 'review' key in response")
            print(f"Response: {data}")
            return False
        
        review = data['review']
        print(f"Review keys: {list(review.keys())}")
        
        # Check required fields
        if 'id' not in review:
            print(f"❌ FAILED: Review missing 'id' field")
            return False
        
        if review.get('comment') != "Great seller, fast delivery":
            print(f"❌ FAILED: Review comment mismatch, got {review.get('comment')}")
            return False
        
        if review.get('rating') != "positive":
            print(f"❌ FAILED: Review rating mismatch, got {review.get('rating')}")
            return False
        
        if review.get('source') != 'manual':
            print(f"❌ FAILED: Review source should be 'manual', got {review.get('source')}")
            return False
        
        review_id = review['id']
        print(f"✓ Review created with id: {review_id}")
        print(f"✓ comment: {review['comment']}")
        print(f"✓ rating: {review['rating']}")
        print(f"✓ source: {review['source']}")
        
        # Verify review appears in GET /api/reviews
        print("Step (b): Verify review appears in GET /api/reviews...")
        get_response = requests.get(f"{API_URL}/reviews", timeout=30)
        get_data = get_response.json()
        
        found = False
        for r in get_data['reviews']:
            if r.get('id') == review_id:
                found = True
                print(f"✓ Review {review_id} found in GET /api/reviews")
                break
        
        if not found:
            print(f"❌ FAILED: Review {review_id} not found in GET /api/reviews")
            return False
        
        print("✅ PASSED: Admin can create manual review and it appears in public endpoint")
        return review_id  # Return review_id for use in delete test
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_admin_create_review_negative():
    """Test 3b: POST /api/admin/reviews without comment (NEGATIVE)"""
    print("\n=== TEST 3b: POST /api/admin/reviews without comment (NEGATIVE) ===")
    try:
        # Admin login
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        # Try to create review without comment
        print("Attempting to create review without comment...")
        review_data = {
            "author": "x"
            # Missing comment
        }
        response = requests.post(f"{API_URL}/admin/reviews",
                                json=review_data,
                                headers={"Authorization": f"Bearer {admin_token}"},
                                timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 400:
            print(f"❌ FAILED: Expected HTTP 400, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 400 when comment is missing")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_admin_import_ebay():
    """Test 4: POST /api/admin/reviews/import-ebay with eBay URL"""
    print("\n=== TEST 4: POST /api/admin/reviews/import-ebay ===")
    try:
        # Admin login
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        # Import from eBay
        print("Step (a): POST /api/admin/reviews/import-ebay with bloxifier URL...")
        import_data = {
            "url": "https://www.ebay.com/fdbk/feedback_profile/bloxifier?filter=feedback_page%3ARECEIVED_AS_SELLER&sort=RELEVANCEV2",
            "setTotalSales": True
        }
        response = requests.post(f"{API_URL}/admin/reviews/import-ebay",
                                json=import_data,
                                headers={"Authorization": f"Bearer {admin_token}"},
                                timeout=60)  # Longer timeout for eBay scraping
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response: {data}")
        
        # Check required fields
        required_keys = ['imported', 'skipped', 'detected', 'feedbackScore', 'handle']
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            print(f"❌ FAILED: Missing required keys: {missing_keys}")
            return False
        
        if not isinstance(data['imported'], int):
            print(f"❌ FAILED: imported should be number, got {type(data['imported'])}")
            return False
        
        if not isinstance(data['skipped'], int):
            print(f"❌ FAILED: skipped should be number, got {type(data['skipped'])}")
            return False
        
        if not isinstance(data['detected'], int):
            print(f"❌ FAILED: detected should be number, got {type(data['detected'])}")
            return False
        
        if data['detected'] < 1:
            print(f"❌ FAILED: detected should be >= 1, got {data['detected']}")
            return False
        
        if data['handle'] != 'bloxifier':
            print(f"❌ FAILED: handle should be 'bloxifier', got {data['handle']}")
            return False
        
        print(f"✓ imported: {data['imported']}")
        print(f"✓ skipped: {data['skipped']}")
        print(f"✓ detected: {data['detected']}")
        print(f"✓ feedbackScore: {data['feedbackScore']}")
        print(f"✓ handle: {data['handle']}")
        
        # Run import again to test deduplication
        print("Step (b): Run import again to test deduplication...")
        response2 = requests.post(f"{API_URL}/admin/reviews/import-ebay",
                                 json=import_data,
                                 headers={"Authorization": f"Bearer {admin_token}"},
                                 timeout=60)
        
        if response2.status_code != 200:
            print(f"❌ FAILED: Second import failed with status {response2.status_code}")
            return False
        
        data2 = response2.json()
        print(f"Second import response: {data2}")
        
        if data2['skipped'] <= 0:
            print(f"❌ FAILED: Second import should have skipped > 0 (deduplication), got {data2['skipped']}")
            return False
        
        print(f"✓ Second import skipped {data2['skipped']} reviews (deduplication working)")
        
        print("✅ PASSED: eBay import working with deduplication")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_admin_import_ebay_negative():
    """Test 4b: POST /api/admin/reviews/import-ebay with invalid URL (NEGATIVE)"""
    print("\n=== TEST 4b: POST /api/admin/reviews/import-ebay with invalid URL (NEGATIVE) ===")
    try:
        # Admin login
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        # Try to import from invalid URL
        print("Attempting to import from google.com...")
        import_data = {
            "url": "https://www.google.com"
        }
        response = requests.post(f"{API_URL}/admin/reviews/import-ebay",
                                json=import_data,
                                headers={"Authorization": f"Bearer {admin_token}"},
                                timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 400:
            print(f"❌ FAILED: Expected HTTP 400, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 400 for invalid URL")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_admin_delete_review(review_id):
    """Test 5: DELETE /api/admin/reviews/{id} as admin"""
    print(f"\n=== TEST 5: DELETE /api/admin/reviews/{review_id} ===")
    try:
        # Admin login
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        # Delete review
        print(f"Step (a): DELETE /api/admin/reviews/{review_id}...")
        response = requests.delete(f"{API_URL}/admin/reviews/{review_id}",
                                  headers={"Authorization": f"Bearer {admin_token}"},
                                  timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response: {data}")
        
        if data.get('success') != True:
            print(f"❌ FAILED: Expected success=true, got {data.get('success')}")
            return False
        
        print(f"✓ success: {data['success']}")
        
        # Verify review is gone from GET /api/reviews
        print("Step (b): Verify review is gone from GET /api/reviews...")
        get_response = requests.get(f"{API_URL}/reviews", timeout=30)
        get_data = get_response.json()
        
        found = False
        for r in get_data['reviews']:
            if r.get('id') == review_id:
                found = True
                break
        
        if found:
            print(f"❌ FAILED: Review {review_id} still found in GET /api/reviews after deletion")
            return False
        
        print(f"✓ Review {review_id} no longer present in GET /api/reviews")
        print("✅ PASSED: Admin can delete review and it's removed from public endpoint")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_admin_guard():
    """Test 6: Admin guard - non-admin users should get 403"""
    print("\n=== TEST 6: Admin guard tests ===")
    try:
        # Signup normal user
        import random
        user_num = random.randint(10000, 99999)
        signup_data = {
            "username": f"testuser{user_num}",
            "email": f"testuser{user_num}@test.com",
            "password": "testpass123"
        }
        signup_response = requests.post(f"{API_URL}/auth/signup",
                                       json=signup_data,
                                       timeout=30)
        user_token = signup_response.json()['token']
        print(f"✓ Normal user signup successful")
        
        # Test 1: POST /api/admin/reviews/settings with non-admin token
        print("Test (a): POST /api/admin/reviews/settings with non-admin token...")
        response1 = requests.post(f"{API_URL}/admin/reviews/settings",
                                 json={"totalSales": 999},
                                 headers={"Authorization": f"Bearer {user_token}"},
                                 timeout=30)
        
        if response1.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response1.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews/settings returns 403 for non-admin")
        
        # Test 2: POST /api/admin/reviews with non-admin token
        print("Test (b): POST /api/admin/reviews with non-admin token...")
        response2 = requests.post(f"{API_URL}/admin/reviews",
                                 json={"author": "x", "comment": "test"},
                                 headers={"Authorization": f"Bearer {user_token}"},
                                 timeout=30)
        
        if response2.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response2.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews returns 403 for non-admin")
        
        # Test 3: POST /api/admin/reviews/import-ebay with non-admin token
        print("Test (c): POST /api/admin/reviews/import-ebay with non-admin token...")
        response3 = requests.post(f"{API_URL}/admin/reviews/import-ebay",
                                 json={"url": "https://www.ebay.com/fdbk/feedback_profile/bloxifier"},
                                 headers={"Authorization": f"Bearer {user_token}"},
                                 timeout=30)
        
        if response3.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response3.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews/import-ebay returns 403 for non-admin")
        
        # Test 4: DELETE /api/admin/reviews/anyid with non-admin token
        print("Test (d): DELETE /api/admin/reviews/anyid with non-admin token...")
        response4 = requests.delete(f"{API_URL}/admin/reviews/anyid",
                                   headers={"Authorization": f"Bearer {user_token}"},
                                   timeout=30)
        
        if response4.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response4.status_code}")
            return False
        print(f"✓ DELETE /api/admin/reviews/anyid returns 403 for non-admin")
        
        # Test 5: POST /api/admin/reviews/settings with NO Authorization header
        print("Test (e): POST /api/admin/reviews/settings with NO Authorization header...")
        response5 = requests.post(f"{API_URL}/admin/reviews/settings",
                                 json={"totalSales": 999},
                                 timeout=30)
        
        if response5.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response5.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews/settings returns 403 with no auth")
        
        # Test 6: POST /api/admin/reviews with NO Authorization header
        print("Test (f): POST /api/admin/reviews with NO Authorization header...")
        response6 = requests.post(f"{API_URL}/admin/reviews",
                                 json={"author": "x", "comment": "test"},
                                 timeout=30)
        
        if response6.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response6.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews returns 403 with no auth")
        
        # Test 7: POST /api/admin/reviews/import-ebay with NO Authorization header
        print("Test (g): POST /api/admin/reviews/import-ebay with NO Authorization header...")
        response7 = requests.post(f"{API_URL}/admin/reviews/import-ebay",
                                 json={"url": "https://www.ebay.com/fdbk/feedback_profile/bloxifier"},
                                 timeout=30)
        
        if response7.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response7.status_code}")
            return False
        print(f"✓ POST /api/admin/reviews/import-ebay returns 403 with no auth")
        
        # Test 8: DELETE /api/admin/reviews/anyid with NO Authorization header
        print("Test (h): DELETE /api/admin/reviews/anyid with NO Authorization header...")
        response8 = requests.delete(f"{API_URL}/admin/reviews/anyid",
                                   timeout=30)
        
        if response8.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response8.status_code}")
            return False
        print(f"✓ DELETE /api/admin/reviews/anyid returns 403 with no auth")
        
        print("✅ PASSED: All admin guard tests passed (8/8)")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_regression_config():
    """Test 7: Regression - GET /api/config"""
    print("\n=== TEST 7: Regression - GET /api/config ===")
    try:
        response = requests.get(f"{API_URL}/config", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            return False
        
        data = response.json()
        print(f"Response: {data}")
        
        if data.get('cryptoConfigured') != True:
            print(f"❌ FAILED: Expected cryptoConfigured=true, got {data.get('cryptoConfigured')}")
            return False
        
        if data.get('provider') != 'blockbee':
            print(f"❌ FAILED: Expected provider='blockbee', got {data.get('provider')}")
            return False
        
        print("✅ PASSED: GET /api/config returns cryptoConfigured=true, provider='blockbee'")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_regression_checkout_eligibility():
    """Test 8: Regression - GET /api/checkout/eligibility?userId=156"""
    print("\n=== TEST 8: Regression - GET /api/checkout/eligibility?userId=156 ===")
    try:
        response = requests.get(f"{API_URL}/checkout/eligibility", params={"userId": "156"}, timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        
        if 'eligibility' not in data:
            print(f"❌ FAILED: Missing 'eligibility' key in response")
            return False
        
        eligibility = data['eligibility']
        
        if 'premiumChecked' not in eligibility:
            print(f"❌ FAILED: Missing 'premiumChecked' key in eligibility")
            return False
        
        if eligibility['premiumChecked'] != True:
            print(f"❌ FAILED: Expected premiumChecked=true, got {eligibility['premiumChecked']}")
            return False
        
        print(f"✓ premiumChecked: {eligibility['premiumChecked']}")
        print("✅ PASSED: GET /api/checkout/eligibility working correctly")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def main():
    print("=" * 80)
    print("BACKEND TESTING - UPDATE 12: Reviews + eBay Import")
    print("=" * 80)
    print(f"API URL: {API_URL}")
    
    # Store review_id from test 3 for use in test 5
    review_id_for_delete = None
    
    tests = [
        ("GET /api/reviews (public, no auth)", test_get_reviews_public, None),
        ("POST /api/admin/reviews/settings", test_admin_reviews_settings, None),
        ("POST /api/admin/reviews (create manual review)", test_admin_create_review, "save_review_id"),
        ("POST /api/admin/reviews without comment (NEGATIVE)", test_admin_create_review_negative, None),
        ("POST /api/admin/reviews/import-ebay", test_admin_import_ebay, None),
        ("POST /api/admin/reviews/import-ebay invalid URL (NEGATIVE)", test_admin_import_ebay_negative, None),
        ("DELETE /api/admin/reviews/{id}", None, "use_review_id"),  # Will be called with review_id
        ("Admin guard tests (8 tests)", test_admin_guard, None),
        ("Regression: GET /api/config", test_regression_config, None),
        ("Regression: GET /api/checkout/eligibility", test_regression_checkout_eligibility, None),
    ]
    
    results = []
    for name, test_func, special in tests:
        try:
            if special == "save_review_id":
                result = test_func()
                if result and isinstance(result, str):
                    review_id_for_delete = result
                    results.append((name, True))
                else:
                    results.append((name, False))
            elif special == "use_review_id":
                if review_id_for_delete:
                    result = test_admin_delete_review(review_id_for_delete)
                    results.append((name, result))
                else:
                    print(f"\n⚠ Skipping DELETE test - no review_id available")
                    results.append((name, False))
            else:
                result = test_func()
                results.append((name, result))
        except Exception as e:
            print(f"\n❌ Test '{name}' crashed: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    print("=" * 80)
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Backend API tests for UPDATE 11: Checkout eligibility + buyer info
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

def test_checkout_eligibility_valid():
    """Test 1: GET /api/checkout/eligibility?userId=156 (builderman)"""
    print("\n=== TEST 1: GET /api/checkout/eligibility?userId=156 ===")
    try:
        response = requests.get(f"{API_URL}/checkout/eligibility", params={"userId": "156"}, timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        if 'eligibility' not in data:
            print(f"❌ FAILED: Missing 'eligibility' key in response")
            print(f"Response: {data}")
            return False
        
        eligibility = data['eligibility']
        print(f"Eligibility keys: {list(eligibility.keys())}")
        
        # Check all required keys
        required_keys = ['premium', 'premiumChecked', 'inventoryPublic', 'inventoryChecked', 
                        'tradesChecked', 'tradeStatus', 'limiteds', 'rapLimit']
        missing_keys = [k for k in required_keys if k not in eligibility]
        if missing_keys:
            print(f"❌ FAILED: Missing required keys: {missing_keys}")
            return False
        
        # Validate types
        if not isinstance(eligibility['premium'], bool):
            print(f"❌ FAILED: premium should be boolean, got {type(eligibility['premium'])}")
            return False
        
        if eligibility['premiumChecked'] != True:
            print(f"❌ FAILED: premiumChecked should be true, got {eligibility['premiumChecked']}")
            return False
        
        if not isinstance(eligibility['inventoryPublic'], bool):
            print(f"❌ FAILED: inventoryPublic should be boolean, got {type(eligibility['inventoryPublic'])}")
            return False
        
        if eligibility['inventoryChecked'] != True:
            print(f"❌ FAILED: inventoryChecked should be true, got {eligibility['inventoryChecked']}")
            return False
        
        if not isinstance(eligibility['tradesChecked'], bool):
            print(f"❌ FAILED: tradesChecked should be boolean, got {type(eligibility['tradesChecked'])}")
            return False
        
        if not isinstance(eligibility['limiteds'], list):
            print(f"❌ FAILED: limiteds should be array, got {type(eligibility['limiteds'])}")
            return False
        
        if eligibility['rapLimit'] != 1500:
            print(f"❌ FAILED: rapLimit should be 1500, got {eligibility['rapLimit']}")
            return False
        
        # For builderman (156), expect premium=true and inventoryPublic=true
        if eligibility['premium'] != True:
            print(f"❌ FAILED: For builderman (156), expected premium=true, got {eligibility['premium']}")
            return False
        
        if eligibility['inventoryPublic'] != True:
            print(f"❌ FAILED: For builderman (156), expected inventoryPublic=true, got {eligibility['inventoryPublic']}")
            return False
        
        # Check limiteds array structure if non-empty
        if len(eligibility['limiteds']) > 0:
            first_limited = eligibility['limiteds'][0]
            required_limited_keys = ['assetId', 'name', 'rap', 'imageUrl']
            missing_limited_keys = [k for k in required_limited_keys if k not in first_limited]
            if missing_limited_keys:
                print(f"❌ FAILED: Limited item missing keys: {missing_limited_keys}")
                return False
            print(f"✓ Limiteds array has {len(eligibility['limiteds'])} items with correct structure")
        
        print(f"✓ premium: {eligibility['premium']}")
        print(f"✓ premiumChecked: {eligibility['premiumChecked']}")
        print(f"✓ inventoryPublic: {eligibility['inventoryPublic']}")
        print(f"✓ inventoryChecked: {eligibility['inventoryChecked']}")
        print(f"✓ tradesChecked: {eligibility['tradesChecked']}")
        print(f"✓ tradeStatus: {eligibility['tradeStatus']}")
        print(f"✓ limiteds count: {len(eligibility['limiteds'])}")
        print(f"✓ rapLimit: {eligibility['rapLimit']}")
        print("✅ PASSED: All eligibility fields present and valid for builderman")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_checkout_eligibility_no_userid():
    """Test 2: GET /api/checkout/eligibility with NO userId param"""
    print("\n=== TEST 2: GET /api/checkout/eligibility (no userId) ===")
    try:
        response = requests.get(f"{API_URL}/checkout/eligibility", timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 400:
            print(f"❌ FAILED: Expected HTTP 400, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 400 when userId is missing")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_checkout_eligibility_non_numeric():
    """Test 3: GET /api/checkout/eligibility?userId=abc (non-numeric)"""
    print("\n=== TEST 3: GET /api/checkout/eligibility?userId=abc ===")
    try:
        response = requests.get(f"{API_URL}/checkout/eligibility", params={"userId": "abc"}, timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code != 400:
            print(f"❌ FAILED: Expected HTTP 400, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 400 for non-numeric userId")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_checkout_eligibility_nonexistent():
    """Test 4: GET /api/checkout/eligibility?userId=999999999999 (nonexistent)"""
    print("\n=== TEST 4: GET /api/checkout/eligibility?userId=999999999999 ===")
    try:
        response = requests.get(f"{API_URL}/checkout/eligibility", params={"userId": "999999999999"}, timeout=30)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 500:
            print(f"❌ FAILED: Must NOT return HTTP 500 for nonexistent user")
            print(f"Response: {response.text}")
            return False
        
        if response.status_code == 200:
            data = response.json()
            if 'eligibility' in data:
                eligibility = data['eligibility']
                print(f"✓ Returns HTTP 200 with eligibility object")
                print(f"  - limiteds: {len(eligibility.get('limiteds', []))} items")
                print(f"  - premium: {eligibility.get('premium')}")
                print(f"  - inventoryPublic: {eligibility.get('inventoryPublic')}")
                print("✅ PASSED: Returns HTTP 200 with eligibility object (limiteds empty)")
                return True
        elif response.status_code == 502:
            print("✅ PASSED: Returns HTTP 502 (acceptable for nonexistent user)")
            return True
        else:
            print(f"✓ Returns HTTP {response.status_code} (not 500, acceptable)")
            print("✅ PASSED: Does not return HTTP 500")
            return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_orders_regression_with_new_fields():
    """Test 5: ORDERS regression + new fields (robloxUserId, giveItems)"""
    print("\n=== TEST 5: ORDERS regression + new fields ===")
    try:
        # (a) Admin login
        print("Step (a): Admin login...")
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        if login_response.status_code != 200:
            print(f"❌ FAILED: Admin login failed with status {login_response.status_code}")
            return False
        
        admin_token = login_response.json()['token']
        print(f"✓ Admin login successful")
        
        # (b) Create listing
        print("Step (b): Create listing...")
        listing_data = {
            "name": "Elig Test",
            "imageUrl": "https://tr.rbxcdn.com/x/150/150/Hat/Png/noFilter",
            "category": "Limiteds",
            "stock": 3,
            "price": 12.5,
            "condition": "Limited"
        }
        create_listing_response = requests.post(f"{API_URL}/admin/listings",
                                               json=listing_data,
                                               headers={"Authorization": f"Bearer {admin_token}"},
                                               timeout=30)
        if create_listing_response.status_code != 200:
            print(f"❌ FAILED: Create listing failed with status {create_listing_response.status_code}")
            print(f"Response: {create_listing_response.text}")
            return False
        
        listing_id = create_listing_response.json()['listing']['id']
        print(f"✓ Listing created with id: {listing_id}")
        
        # (c) Signup normal user
        print("Step (c): Signup normal user...")
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
        if signup_response.status_code != 200:
            print(f"❌ FAILED: Signup failed with status {signup_response.status_code}")
            print(f"Response: {signup_response.text}")
            return False
        
        user_token = signup_response.json()['token']
        print(f"✓ User signup successful")
        
        # (d) Create order with new fields
        print("Step (d): Create order with robloxUserId and giveItems...")
        order_data = {
            "listingId": listing_id,
            "discordName": "cooldude",
            "discordTag": "1234",
            "robloxUsername": "builderman",
            "robloxUserId": 156,
            "giveItems": [
                {
                    "assetId": 17408283,
                    "name": "Hard Hat",
                    "rap": 965
                }
            ]
        }
        create_order_response = requests.post(f"{API_URL}/orders",
                                             json=order_data,
                                             headers={"Authorization": f"Bearer {user_token}"},
                                             timeout=30)
        if create_order_response.status_code != 200:
            print(f"❌ FAILED: Create order failed with status {create_order_response.status_code}")
            print(f"Response: {create_order_response.text}")
            return False
        
        order_response_data = create_order_response.json()
        order_id = order_response_data.get('orderId')
        checkout_url = order_response_data.get('checkoutUrl')
        
        print(f"✓ Order created with orderId: {order_id}")
        
        if checkout_url and checkout_url.startswith('https://pay.blockbee.io/payment/'):
            print(f"✓ checkoutUrl starts with 'https://pay.blockbee.io/payment/'")
        elif checkout_url is None and order_response_data.get('simulated'):
            print(f"✓ Demo mode: simulated=true, checkoutUrl=null")
        else:
            print(f"⚠ checkoutUrl: {checkout_url}")
        
        # (e) Verify order in admin orders
        print("Step (e): Verify order in GET /api/admin/orders...")
        admin_orders_response = requests.get(f"{API_URL}/admin/orders",
                                            headers={"Authorization": f"Bearer {admin_token}"},
                                            timeout=30)
        if admin_orders_response.status_code != 200:
            print(f"❌ FAILED: GET admin/orders failed with status {admin_orders_response.status_code}")
            return False
        
        orders = admin_orders_response.json()['orders']
        target_order = None
        for order in orders:
            if order.get('orderId') == order_id:
                target_order = order
                break
        
        if not target_order:
            print(f"❌ FAILED: Order {order_id} not found in admin orders")
            return False
        
        print(f"✓ Order found in admin orders")
        
        # Verify buyerInfo
        buyer_info = target_order.get('buyerInfo')
        if not buyer_info:
            print(f"❌ FAILED: buyerInfo missing in order")
            return False
        
        if buyer_info.get('robloxUserId') != 156:
            print(f"❌ FAILED: buyerInfo.robloxUserId should be 156, got {buyer_info.get('robloxUserId')}")
            return False
        
        print(f"✓ buyerInfo.robloxUserId === 156")
        
        give_items = buyer_info.get('giveItems')
        if not give_items or len(give_items) != 1:
            print(f"❌ FAILED: buyerInfo.giveItems should have length 1, got {len(give_items) if give_items else 0}")
            return False
        
        print(f"✓ buyerInfo.giveItems length === 1")
        
        if give_items[0].get('assetId') != 17408283:
            print(f"❌ FAILED: giveItems[0].assetId should be 17408283, got {give_items[0].get('assetId')}")
            return False
        
        print(f"✓ buyerInfo.giveItems[0].assetId === 17408283")
        
        print("✅ PASSED: Orders regression with new fields (robloxUserId, giveItems) working correctly")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_orders_without_roblox_username():
    """Test 6: POST /api/orders without robloxUsername"""
    print("\n=== TEST 6: POST /api/orders without robloxUsername ===")
    try:
        # Admin login and create listing
        login_response = requests.post(f"{API_URL}/auth/login", 
                                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                                      timeout=30)
        admin_token = login_response.json()['token']
        
        listing_data = {
            "name": "Test Item Negative",
            "imageUrl": "https://tr.rbxcdn.com/x/150/150/Hat/Png/noFilter",
            "category": "Limiteds",
            "stock": 1,
            "price": 5.0,
            "condition": "Limited"
        }
        create_listing_response = requests.post(f"{API_URL}/admin/listings",
                                               json=listing_data,
                                               headers={"Authorization": f"Bearer {admin_token}"},
                                               timeout=30)
        listing_id = create_listing_response.json()['listing']['id']
        
        # Signup user
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
        
        # Try to create order WITHOUT robloxUsername
        order_data = {
            "listingId": listing_id,
            "discordName": "x"
            # Missing robloxUsername
        }
        create_order_response = requests.post(f"{API_URL}/orders",
                                             json=order_data,
                                             headers={"Authorization": f"Bearer {user_token}"},
                                             timeout=30)
        
        print(f"Status: {create_order_response.status_code}")
        
        if create_order_response.status_code != 400:
            print(f"❌ FAILED: Expected HTTP 400, got {create_order_response.status_code}")
            print(f"Response: {create_order_response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 400 when robloxUsername is missing")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_config_regression():
    """Test 7: GET /api/config regression"""
    print("\n=== TEST 7: GET /api/config ===")
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
        
        print("✅ PASSED: Config returns cryptoConfigured=true, provider='blockbee'")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def test_payments_simulate_blocked():
    """Test 8: POST /api/payments/simulate should return 403"""
    print("\n=== TEST 8: POST /api/payments/simulate (should be blocked) ===")
    try:
        # Signup user
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
        
        # Try to simulate payment
        response = requests.post(f"{API_URL}/payments/simulate",
                                json={"orderId": "whatever"},
                                headers={"Authorization": f"Bearer {user_token}"},
                                timeout=30)
        
        print(f"Status: {response.status_code}")
        
        if response.status_code != 403:
            print(f"❌ FAILED: Expected HTTP 403, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        print("✅ PASSED: Returns HTTP 403 (simulate blocked when crypto configured)")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception - {str(e)}")
        return False

def main():
    print("=" * 80)
    print("BACKEND TESTING - UPDATE 11: Checkout Eligibility + Buyer Info")
    print("=" * 80)
    print(f"API URL: {API_URL}")
    
    tests = [
        ("Eligibility valid userId (builderman)", test_checkout_eligibility_valid),
        ("Eligibility no userId", test_checkout_eligibility_no_userid),
        ("Eligibility non-numeric userId", test_checkout_eligibility_non_numeric),
        ("Eligibility nonexistent userId", test_checkout_eligibility_nonexistent),
        ("Orders regression + new fields", test_orders_regression_with_new_fields),
        ("Orders without robloxUsername", test_orders_without_roblox_username),
        ("Config regression", test_config_regression),
        ("Payments simulate blocked", test_payments_simulate_blocked),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n❌ Test '{name}' crashed: {e}")
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

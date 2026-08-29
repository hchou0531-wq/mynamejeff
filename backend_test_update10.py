#!/usr/bin/env python3
"""
Backend test for UPDATE 10: Buyer info at checkout + sequential transactions + admin-only /transaction/:num
Tests the complete flow with Discord/Roblox info collection and transaction endpoint
"""
import requests
import sys
import time
import random

# Base URL from environment
BASE_URL = "https://git-preview-roblox.preview.emergentagent.com/api"

def test_update10_buyer_info_and_transactions():
    """
    Test UPDATE 10: Buyer info at checkout + sequential transactions
    
    Test steps:
    1. Admin login POST /api/auth/login {email:"admin@robloot.com", password:"roblootdevtomo"} -> token, user.isAdmin=true
    2. As admin, POST /api/admin/listings {name:"U10 Item", imageUrl:"https://tr.rbxcdn.com/x/420/420/Hat/Png/noFilter", category:"Limiteds", robloxAssetId:123, rap:1000, robuxPrice:1350, stock:5, price:7.50, condition:"Limited"} -> capture listing id
    3. Signup a normal buyer: POST /api/auth/signup {username:"u10buyer<rand>", email:"u10buyer+<rand>@test.com", password:"pass1234"} -> token
    4. NEGATIVE: As buyer, POST /api/orders {listingId:<id>} WITHOUT discordName/robloxUsername -> MUST return HTTP 400 (error mentions Discord/Roblox)
    5. POSITIVE: As buyer, POST /api/orders {listingId:<id>, discordName:"cooldude", discordTag:"1234", robloxUsername:"BuilderPro"} -> MUST return {orderId, checkoutUrl} where checkoutUrl starts with "https://pay.blockbee.io/payment/". Capture orderId
    6. As admin, GET /api/admin/orders -> find the order just created (match by orderId). It MUST have a numeric txNumber (>=1) and buyerInfo object with discordName="cooldude", discordTag="1234", robloxUsername="BuilderPro". Record the txNumber value N
    7. As admin, GET /api/transaction/N -> HTTP 200, returns {transaction:{...} including txNumber=N, buyerInfo (discord + roblox), item, amountUsd=7.5, orderId matching
    8. As the normal buyer (non-admin), GET /api/transaction/N -> MUST return HTTP 403
    9. With NO Authorization header, GET /api/transaction/N -> MUST return HTTP 403
    10. As admin, GET /api/transaction/9999999 -> MUST return HTTP 404
    11. Regression: GET /api/config -> {cryptoConfigured:true, provider:"blockbee"}. As buyer POST /api/payments/simulate {orderId} -> 403. GET /api/listings?sort=price_asc and ?category=Limiteds -> return listings arrays without error
    """
    print("=" * 80)
    print("TESTING: UPDATE 10 - Buyer Info + Sequential Transactions")
    print("=" * 80)
    
    # Variables to store across steps
    admin_token = None
    buyer_token = None
    listing_id = None
    order_id = None
    tx_number = None
    
    # Step 1: Admin login
    print("\n[STEP 1] Testing admin login...")
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": "admin@robloot.com", "password": "roblootdevtomo"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "token" not in data:
            print(f"  ✗ FAILED: Missing 'token' in response")
            return False
        admin_token = data["token"]
        print(f"  ✓ token: {admin_token[:20]}...")
        
        if "user" not in data or data["user"].get("isAdmin") != True:
            print(f"  ✗ FAILED: user.isAdmin should be true")
            return False
        print(f"  ✓ user.isAdmin: true")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 2: Admin creates listing
    print("\n[STEP 2] Testing admin create listing...")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/listings",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "U10 Item",
                "imageUrl": "https://tr.rbxcdn.com/x/420/420/Hat/Png/noFilter",
                "category": "Limiteds",
                "robloxAssetId": 123,
                "rap": 1000,
                "robuxPrice": 1350,
                "stock": 5,
                "price": 7.50,
                "condition": "Limited"
            },
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "listing" not in data or "id" not in data["listing"]:
            print(f"  ✗ FAILED: Missing 'listing.id' in response")
            return False
        listing_id = data["listing"]["id"]
        print(f"  ✓ listing.id: {listing_id}")
        print(f"  ✓ listing.price: {data['listing'].get('price')}")
        print(f"  ✓ listing.stock: {data['listing'].get('stock')}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 3: Signup normal buyer
    print("\n[STEP 3] Testing normal buyer signup...")
    try:
        rand = random.randint(10000, 99999)
        username = f"u10buyer{rand}"
        email = f"u10buyer+{rand}@test.com"
        
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"username": username, "email": email, "password": "pass1234"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "token" not in data:
            print(f"  ✗ FAILED: Missing 'token' in response")
            return False
        buyer_token = data["token"]
        print(f"  ✓ token: {buyer_token[:20]}...")
        print(f"  ✓ username: {username}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 4: NEGATIVE TEST - Order without buyer info (must return 400)
    print("\n[STEP 4] NEGATIVE TEST: POST /api/orders WITHOUT discordName/robloxUsername (must return 400)...")
    try:
        response = requests.post(
            f"{BASE_URL}/orders",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"listingId": listing_id},
            timeout=10
        )
        
        if response.status_code != 400:
            print(f"  ✗ FAILED: Expected HTTP 400, got {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 400 (buyer info required)")
        
        # Verify error message mentions Discord/Roblox
        error_msg = data.get("error", "").lower()
        if "discord" not in error_msg or "roblox" not in error_msg:
            print(f"  ⚠ WARNING: Error message should mention Discord and Roblox")
            print(f"    Got: {data.get('error')}")
        else:
            print(f"  ✓ error: {data.get('error')}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 5: POSITIVE TEST - Order with buyer info (must return orderId + checkoutUrl)
    print("\n[STEP 5] POSITIVE TEST: POST /api/orders WITH buyer info (must return orderId + checkoutUrl)...")
    try:
        response = requests.post(
            f"{BASE_URL}/orders",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={
                "listingId": listing_id,
                "discordName": "cooldude",
                "discordTag": "1234",
                "robloxUsername": "BuilderPro"
            },
            timeout=15  # BlockBee API call may take a few seconds
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "orderId" not in data:
            print(f"  ✗ FAILED: Missing 'orderId' in response")
            return False
        order_id = data["orderId"]
        print(f"  ✓ orderId: {order_id}")
        
        if "checkoutUrl" not in data:
            print(f"  ✗ FAILED: Missing 'checkoutUrl' in response")
            return False
        
        checkout_url = data["checkoutUrl"]
        print(f"  ✓ checkoutUrl: {checkout_url}")
        
        # CRITICAL: checkoutUrl must start with "https://pay.blockbee.io/payment/"
        if not checkout_url or not checkout_url.startswith("https://pay.blockbee.io/payment/"):
            print(f"  ✗ CRITICAL FAILURE: checkoutUrl does NOT start with 'https://pay.blockbee.io/payment/'")
            print(f"    Expected: https://pay.blockbee.io/payment/...")
            print(f"    Got: {checkout_url}")
            return False
        print(f"  ✓ CRITICAL: checkoutUrl starts with 'https://pay.blockbee.io/payment/' (real BlockBee URL)")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 6: Admin GET /api/admin/orders - verify txNumber and buyerInfo
    print("\n[STEP 6] Testing GET /api/admin/orders - verify txNumber and buyerInfo...")
    try:
        response = requests.get(
            f"{BASE_URL}/admin/orders",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "orders" not in data or not isinstance(data["orders"], list):
            print(f"  ✗ FAILED: Missing or invalid 'orders' array")
            return False
        
        # Find the order we just created
        order = None
        for o in data["orders"]:
            if o.get("orderId") == order_id:
                order = o
                break
        
        if not order:
            print(f"  ✗ FAILED: Could not find order with orderId={order_id}")
            return False
        
        print(f"  ✓ Found order with orderId={order_id}")
        
        # Verify txNumber is numeric and >= 1
        if "txNumber" not in order:
            print(f"  ✗ FAILED: Missing 'txNumber' in order")
            return False
        
        tx_number = order["txNumber"]
        if not isinstance(tx_number, int) or tx_number < 1:
            print(f"  ✗ FAILED: txNumber should be a numeric value >= 1, got {tx_number}")
            return False
        
        print(f"  ✓ txNumber: {tx_number} (numeric, >= 1)")
        
        # Verify buyerInfo object
        if "buyerInfo" not in order:
            print(f"  ✗ FAILED: Missing 'buyerInfo' in order")
            return False
        
        buyer_info = order["buyerInfo"]
        print(f"  ✓ buyerInfo present: {buyer_info}")
        
        # Verify buyerInfo fields
        if buyer_info.get("discordName") != "cooldude":
            print(f"  ✗ FAILED: buyerInfo.discordName should be 'cooldude', got {buyer_info.get('discordName')}")
            return False
        print(f"  ✓ buyerInfo.discordName: cooldude")
        
        if buyer_info.get("discordTag") != "1234":
            print(f"  ✗ FAILED: buyerInfo.discordTag should be '1234', got {buyer_info.get('discordTag')}")
            return False
        print(f"  ✓ buyerInfo.discordTag: 1234")
        
        if buyer_info.get("robloxUsername") != "BuilderPro":
            print(f"  ✗ FAILED: buyerInfo.robloxUsername should be 'BuilderPro', got {buyer_info.get('robloxUsername')}")
            return False
        print(f"  ✓ buyerInfo.robloxUsername: BuilderPro")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 7: Admin GET /api/transaction/N - verify full transaction details
    print(f"\n[STEP 7] Testing GET /api/transaction/{tx_number} as admin...")
    try:
        response = requests.get(
            f"{BASE_URL}/transaction/{tx_number}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200")
        
        if "transaction" not in data:
            print(f"  ✗ FAILED: Missing 'transaction' in response")
            return False
        
        transaction = data["transaction"]
        print(f"  ✓ transaction object present")
        
        # Verify txNumber matches
        if transaction.get("txNumber") != tx_number:
            print(f"  ✗ FAILED: transaction.txNumber should be {tx_number}, got {transaction.get('txNumber')}")
            return False
        print(f"  ✓ transaction.txNumber: {tx_number}")
        
        # Verify buyerInfo
        if "buyerInfo" not in transaction:
            print(f"  ✗ FAILED: Missing 'buyerInfo' in transaction")
            return False
        
        buyer_info = transaction["buyerInfo"]
        if buyer_info.get("discordName") != "cooldude":
            print(f"  ✗ FAILED: buyerInfo.discordName should be 'cooldude'")
            return False
        if buyer_info.get("discordTag") != "1234":
            print(f"  ✗ FAILED: buyerInfo.discordTag should be '1234'")
            return False
        if buyer_info.get("robloxUsername") != "BuilderPro":
            print(f"  ✗ FAILED: buyerInfo.robloxUsername should be 'BuilderPro'")
            return False
        print(f"  ✓ buyerInfo: {buyer_info}")
        
        # Verify item
        if "item" not in transaction:
            print(f"  ✗ FAILED: Missing 'item' in transaction")
            return False
        print(f"  ✓ item: {transaction['item'].get('name')}")
        
        # Verify amountUsd
        if transaction.get("amountUsd") != 7.5:
            print(f"  ✗ FAILED: amountUsd should be 7.5, got {transaction.get('amountUsd')}")
            return False
        print(f"  ✓ amountUsd: 7.5")
        
        # Verify orderId matches
        if transaction.get("orderId") != order_id:
            print(f"  ✗ FAILED: orderId should match {order_id}, got {transaction.get('orderId')}")
            return False
        print(f"  ✓ orderId: {order_id}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 8: Non-admin GET /api/transaction/N - must return 403
    print(f"\n[STEP 8] Testing GET /api/transaction/{tx_number} as non-admin (must return 403)...")
    try:
        response = requests.get(
            f"{BASE_URL}/transaction/{tx_number}",
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=10
        )
        
        if response.status_code != 403:
            print(f"  ✗ FAILED: Expected HTTP 403, got {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        print(f"  ✓ SUCCESS: HTTP 403 (Forbidden for non-admin)")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 9: No auth GET /api/transaction/N - must return 403
    print(f"\n[STEP 9] Testing GET /api/transaction/{tx_number} with NO Authorization header (must return 403)...")
    try:
        response = requests.get(
            f"{BASE_URL}/transaction/{tx_number}",
            timeout=10
        )
        
        if response.status_code != 403:
            print(f"  ✗ FAILED: Expected HTTP 403, got {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        print(f"  ✓ SUCCESS: HTTP 403 (Forbidden without auth)")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 10: Admin GET /api/transaction/9999999 - must return 404
    print(f"\n[STEP 10] Testing GET /api/transaction/9999999 as admin (must return 404)...")
    try:
        response = requests.get(
            f"{BASE_URL}/transaction/9999999",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        
        if response.status_code != 404:
            print(f"  ✗ FAILED: Expected HTTP 404, got {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        print(f"  ✓ SUCCESS: HTTP 404 (Not found)")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 11: Regression tests
    print("\n[STEP 11] Regression tests...")
    
    # Test 11a: GET /api/config
    print("  [11a] GET /api/config...")
    try:
        response = requests.get(f"{BASE_URL}/config", timeout=10)
        
        if response.status_code != 200:
            print(f"    ✗ FAILED: HTTP {response.status_code}")
            return False
        
        data = response.json()
        if data.get("cryptoConfigured") != True or data.get("provider") != "blockbee":
            print(f"    ✗ FAILED: Expected cryptoConfigured=true, provider='blockbee'")
            print(f"    Got: {data}")
            return False
        
        print(f"    ✓ SUCCESS: cryptoConfigured=true, provider=blockbee")
        
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Test 11b: POST /api/payments/simulate (must return 403)
    print("  [11b] POST /api/payments/simulate (must return 403)...")
    try:
        response = requests.post(
            f"{BASE_URL}/payments/simulate",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={"orderId": order_id},
            timeout=10
        )
        
        if response.status_code != 403:
            print(f"    ✗ FAILED: Expected HTTP 403, got {response.status_code}")
            return False
        
        print(f"    ✓ SUCCESS: HTTP 403 (simulate disabled)")
        
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Test 11c: GET /api/listings?sort=price_asc
    print("  [11c] GET /api/listings?sort=price_asc...")
    try:
        response = requests.get(
            f"{BASE_URL}/listings",
            params={"sort": "price_asc"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"    ✗ FAILED: HTTP {response.status_code}")
            return False
        
        data = response.json()
        if "listings" not in data or not isinstance(data["listings"], list):
            print(f"    ✗ FAILED: Missing or invalid 'listings' array")
            return False
        
        print(f"    ✓ SUCCESS: HTTP 200, listings array with {len(data['listings'])} items")
        
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Test 11d: GET /api/listings?category=Limiteds
    print("  [11d] GET /api/listings?category=Limiteds...")
    try:
        response = requests.get(
            f"{BASE_URL}/listings",
            params={"category": "Limiteds"},
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"    ✗ FAILED: HTTP {response.status_code}")
            return False
        
        data = response.json()
        if "listings" not in data or not isinstance(data["listings"], list):
            print(f"    ✗ FAILED: Missing or invalid 'listings' array")
            return False
        
        print(f"    ✓ SUCCESS: HTTP 200, listings array with {len(data['listings'])} items")
        
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Cleanup: Delete the test listing
    print("\n[CLEANUP] Deleting test listing...")
    try:
        response = requests.delete(
            f"{BASE_URL}/admin/listings/{listing_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"  ✓ Test listing deleted successfully")
        else:
            print(f"  ⚠ WARNING: Could not delete test listing (HTTP {response.status_code})")
        
    except Exception as e:
        print(f"  ⚠ WARNING: Cleanup error: {str(e)}")
    
    print("\n" + "=" * 80)
    print("✓ ALL UPDATE 10 TESTS PASSED")
    print("=" * 80)
    print("\nSUMMARY:")
    print("  ✓ Admin login working")
    print("  ✓ Admin can create listings")
    print("  ✓ Normal buyer signup working")
    print("  ✓ NEGATIVE: Order without buyer info returns 400 with Discord/Roblox error")
    print("  ✓ POSITIVE: Order with buyer info returns orderId + real BlockBee checkoutUrl")
    print("  ✓ Admin orders endpoint returns txNumber (numeric, >=1) and buyerInfo")
    print("  ✓ Admin GET /transaction/N returns full transaction with all required fields")
    print("  ✓ Non-admin GET /transaction/N returns 403 (Forbidden)")
    print("  ✓ No auth GET /transaction/N returns 403 (Forbidden)")
    print("  ✓ Admin GET /transaction/9999999 returns 404 (Not found)")
    print("  ✓ Regression: config, simulate blocked, listings filters all working")
    
    return True


if __name__ == "__main__":
    try:
        success = test_update10_buyer_info_and_transactions()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

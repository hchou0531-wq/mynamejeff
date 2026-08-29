#!/usr/bin/env python3
"""
Backend API Testing for UPDATE 14 - Robloot
Tests: Secret Discord Dashboard access (session code + 2FA verify + overview + bot-config)
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://cookies-8.preview.emergentagent.com/api"
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
                print(f"✓ Admin login successful, token: {token[:20]}..., isAdmin: {is_admin}")
                return token
        print(f"✗ Admin login failed: HTTP {response.status_code}")
        return None
    except Exception as e:
        print(f"✗ Admin login error: {e}")
        return None

def signup_normal_user() -> Optional[str]:
    """Signup a normal (non-admin) user and return token"""
    try:
        import random
        username = f"normaluser{random.randint(10000, 99999)}"
        email = f"{username}@test.com"
        password = "testpass123"
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"username": username, "email": email, "password": password},
            timeout=30
        )
        if response.status_code == 200:
            data = response.json()
            token = data.get("token")
            is_admin = data.get("user", {}).get("isAdmin", False)
            print(f"✓ Normal user signup successful, email: {email}, isAdmin: {is_admin}")
            return token
        print(f"✗ Normal user signup failed: HTTP {response.status_code}")
        return None
    except Exception as e:
        print(f"✗ Normal user signup error: {e}")
        return None

def test_dashboard_session_create(admin_token: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Test 1: POST /api/admin/dashboard/session as admin
    Should return HTTP 200 with {code: 6-digit string, expiresAt, url}
    Returns: (code, secret_slug, url)
    """
    print("\n=== TEST 1: POST /api/admin/dashboard/session (create session code) ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/session",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("POST /admin/dashboard/session returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return None, None, None
        
        data = response.json()
        
        # Check required fields
        if "code" not in data:
            log_test("Response contains 'code' field", False, "Missing 'code' field")
            return None, None, None
        
        if "expiresAt" not in data:
            log_test("Response contains 'expiresAt' field", False, "Missing 'expiresAt' field")
            return None, None, None
        
        if "url" not in data:
            log_test("Response contains 'url' field", False, "Missing 'url' field")
            return None, None, None
        
        code = str(data["code"])
        url = data["url"]
        expires_at = data["expiresAt"]
        
        # Validate code is 6 digits
        if not (code.isdigit() and len(code) == 6):
            log_test("Code is 6-digit string", False, f"Code '{code}' is not 6 digits")
            return None, None, None
        
        log_test("Code is 6-digit string", True, f"Code: {code}")
        
        # Extract secret slug from URL (last path segment)
        secret_slug = url.split('/')[-1] if url else None
        
        if not secret_slug:
            log_test("URL contains secret slug", False, "Could not extract slug from URL")
            return None, None, None
        
        log_test("POST /admin/dashboard/session returns HTTP 200 with valid response", True, 
                f"code={code}, expiresAt={expires_at}, url={url}, secret_slug={secret_slug}")
        
        return code, secret_slug, url
        
    except Exception as e:
        log_test("POST /admin/dashboard/session", False, f"Exception: {e}")
        return None, None, None

def test_dashboard_verify_success(admin_token: str, secret_slug: str, code: str) -> bool:
    """
    Test 2: POST /api/admin/dashboard/verify with correct slug and code
    Should return HTTP 200 with {ok: true}
    """
    print("\n=== TEST 2: POST /api/admin/dashboard/verify (correct slug + code) ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"slug": secret_slug, "code": code},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("POST /admin/dashboard/verify with correct credentials returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}, body: {response.text}")
            return False
        
        data = response.json()
        
        if data.get("ok") != True:
            log_test("Response contains {ok: true}", False, f"Response: {data}")
            return False
        
        log_test("POST /admin/dashboard/verify with correct credentials returns HTTP 200 {ok:true}", True, 
                f"Successfully verified with slug={secret_slug}, code={code}")
        
        return True
        
    except Exception as e:
        log_test("POST /admin/dashboard/verify", False, f"Exception: {e}")
        return False

def test_dashboard_verify_single_use(admin_token: str, secret_slug: str, code: str):
    """
    Test 3: POST /api/admin/dashboard/verify with SAME slug and code again
    Should return HTTP 403 (single-use, code was deleted)
    """
    print("\n=== TEST 3: POST /api/admin/dashboard/verify (same code again - single-use) ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"slug": secret_slug, "code": code},
            timeout=30
        )
        
        if response.status_code != 403:
            log_test("POST /admin/dashboard/verify with used code returns HTTP 403", False, 
                    f"Expected 403, got {response.status_code}, body: {response.text}")
            return
        
        log_test("POST /admin/dashboard/verify with used code returns HTTP 403 (single-use working)", True, 
                f"Code was correctly deleted after first use")
        
    except Exception as e:
        log_test("POST /admin/dashboard/verify single-use", False, f"Exception: {e}")

def test_dashboard_verify_wrong_code(admin_token: str, secret_slug: str):
    """
    Test 4a: POST /api/admin/dashboard/verify with wrong code
    Should return HTTP 403
    """
    print("\n=== TEST 4a: POST /api/admin/dashboard/verify (wrong code) ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"slug": secret_slug, "code": "000000"},
            timeout=30
        )
        
        if response.status_code != 403:
            log_test("POST /admin/dashboard/verify with wrong code returns HTTP 403", False, 
                    f"Expected 403, got {response.status_code}, body: {response.text}")
            return
        
        log_test("POST /admin/dashboard/verify with wrong code returns HTTP 403", True, 
                f"Wrong code '000000' correctly rejected")
        
    except Exception as e:
        log_test("POST /admin/dashboard/verify wrong code", False, f"Exception: {e}")

def test_dashboard_verify_wrong_slug(admin_token: str, code: str):
    """
    Test 4b: POST /api/admin/dashboard/verify with wrong slug
    Should return HTTP 403
    """
    print("\n=== TEST 4b: POST /api/admin/dashboard/verify (wrong slug) ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"slug": "badslug", "code": code},
            timeout=30
        )
        
        if response.status_code != 403:
            log_test("POST /admin/dashboard/verify with wrong slug returns HTTP 403", False, 
                    f"Expected 403, got {response.status_code}, body: {response.text}")
            return
        
        log_test("POST /admin/dashboard/verify with wrong slug returns HTTP 403", True, 
                f"Wrong slug 'badslug' correctly rejected")
        
    except Exception as e:
        log_test("POST /admin/dashboard/verify wrong slug", False, f"Exception: {e}")

def test_dashboard_overview(admin_token: str):
    """
    Test 5: GET /api/admin/dashboard/overview as admin
    Should return HTTP 200 with {stats:{total,paid,pending,revenue}, botConfigured (boolean), orders: array}
    """
    print("\n=== TEST 5: GET /api/admin/dashboard/overview ===")
    try:
        response = requests.get(
            f"{BASE_URL}/admin/dashboard/overview",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /admin/dashboard/overview returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}, body: {response.text}")
            return
        
        data = response.json()
        
        # Check required fields
        required_fields = ["stats", "botConfigured", "orders"]
        missing_fields = [f for f in required_fields if f not in data]
        
        if missing_fields:
            log_test("Response contains all required fields", False, 
                    f"Missing fields: {missing_fields}, response: {data}")
            return
        
        # Check stats structure
        stats = data.get("stats", {})
        required_stats = ["total", "paid", "pending", "revenue"]
        missing_stats = [f for f in required_stats if f not in stats]
        
        if missing_stats:
            log_test("stats contains all required fields", False, 
                    f"Missing stats fields: {missing_stats}, stats: {stats}")
            return
        
        # Check botConfigured is boolean
        bot_configured = data.get("botConfigured")
        if not isinstance(bot_configured, bool):
            log_test("botConfigured is boolean", False, 
                    f"botConfigured is {type(bot_configured)}, value: {bot_configured}")
            return
        
        # Check orders is array
        orders = data.get("orders")
        if not isinstance(orders, list):
            log_test("orders is array", False, 
                    f"orders is {type(orders)}")
            return
        
        log_test("GET /admin/dashboard/overview returns HTTP 200 with valid structure", True, 
                f"stats={{total:{stats['total']}, paid:{stats['paid']}, pending:{stats['pending']}, revenue:{stats['revenue']}}}, botConfigured:{bot_configured}, orders count:{len(orders)}")
        
        return bot_configured
        
    except Exception as e:
        log_test("GET /admin/dashboard/overview", False, f"Exception: {e}")
        return None

def test_dashboard_bot_config_get(admin_token: str):
    """
    Test 6a: GET /api/admin/dashboard/bot-config as admin
    Should return HTTP 200 with {config:{discordBotTokenSet:boolean, ...}}
    """
    print("\n=== TEST 6a: GET /api/admin/dashboard/bot-config ===")
    try:
        response = requests.get(
            f"{BASE_URL}/admin/dashboard/bot-config",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /admin/dashboard/bot-config returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}, body: {response.text}")
            return None
        
        data = response.json()
        
        if "config" not in data:
            log_test("Response contains 'config' field", False, f"Response: {data}")
            return None
        
        config = data["config"]
        
        # Check required fields
        if "discordBotTokenSet" not in config:
            log_test("config contains 'discordBotTokenSet' field", False, f"config: {config}")
            return None
        
        log_test("GET /admin/dashboard/bot-config returns HTTP 200 with valid structure", True, 
                f"config={{discordBotTokenSet:{config.get('discordBotTokenSet')}, discordBotTokenMasked:'{config.get('discordBotTokenMasked', '')}', discordGuildId:'{config.get('discordGuildId', '')}', robloxEnabled:{config.get('robloxEnabled')}}}")
        
        return config
        
    except Exception as e:
        log_test("GET /admin/dashboard/bot-config", False, f"Exception: {e}")
        return None

def test_dashboard_bot_config_post(admin_token: str):
    """
    Test 6b: POST /api/admin/dashboard/bot-config with test data
    Should return HTTP 200 with {success:true}
    """
    print("\n=== TEST 6b: POST /api/admin/dashboard/bot-config ===")
    try:
        response = requests.post(
            f"{BASE_URL}/admin/dashboard/bot-config",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "discordBotToken": "test123456",
                "discordGuildId": "999",
                "robloxEnabled": True
            },
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("POST /admin/dashboard/bot-config returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}, body: {response.text}")
            return False
        
        data = response.json()
        
        if data.get("success") != True:
            log_test("Response contains {success: true}", False, f"Response: {data}")
            return False
        
        log_test("POST /admin/dashboard/bot-config returns HTTP 200 {success:true}", True, 
                f"Bot config updated successfully")
        
        return True
        
    except Exception as e:
        log_test("POST /admin/dashboard/bot-config", False, f"Exception: {e}")
        return False

def test_dashboard_bot_config_verify(admin_token: str):
    """
    Test 6c: GET /api/admin/dashboard/bot-config again to verify changes
    Should show discordBotTokenSet=true, discordBotTokenMasked is non-empty, discordGuildId='999', robloxEnabled=true
    """
    print("\n=== TEST 6c: GET /api/admin/dashboard/bot-config (verify changes) ===")
    try:
        response = requests.get(
            f"{BASE_URL}/admin/dashboard/bot-config",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /admin/dashboard/bot-config returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        config = data.get("config", {})
        
        # Verify discordBotTokenSet is true
        if config.get("discordBotTokenSet") != True:
            log_test("discordBotTokenSet is true", False, 
                    f"Expected true, got {config.get('discordBotTokenSet')}")
            return False
        
        log_test("discordBotTokenSet is true", True)
        
        # Verify discordBotTokenMasked is non-empty
        masked = config.get("discordBotTokenMasked", "")
        if not masked:
            log_test("discordBotTokenMasked is non-empty", False, 
                    f"discordBotTokenMasked is empty")
            return False
        
        log_test("discordBotTokenMasked is non-empty", True, f"Masked token: {masked}")
        
        # Verify discordGuildId is '999'
        if config.get("discordGuildId") != "999":
            log_test("discordGuildId is '999'", False, 
                    f"Expected '999', got '{config.get('discordGuildId')}'")
            return False
        
        log_test("discordGuildId is '999'", True)
        
        # Verify robloxEnabled is true
        if config.get("robloxEnabled") != True:
            log_test("robloxEnabled is true", False, 
                    f"Expected true, got {config.get('robloxEnabled')}")
            return False
        
        log_test("robloxEnabled is true", True)
        
        return True
        
    except Exception as e:
        log_test("GET /admin/dashboard/bot-config verify", False, f"Exception: {e}")
        return False

def test_dashboard_overview_bot_configured(admin_token: str):
    """
    Test 6d: GET /api/admin/dashboard/overview to verify botConfigured is now true
    """
    print("\n=== TEST 6d: GET /api/admin/dashboard/overview (verify botConfigured=true) ===")
    try:
        response = requests.get(
            f"{BASE_URL}/admin/dashboard/overview",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /admin/dashboard/overview returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        bot_configured = data.get("botConfigured")
        
        if bot_configured != True:
            log_test("botConfigured is true after setting bot config", False, 
                    f"Expected true, got {bot_configured}")
            return False
        
        log_test("botConfigured is true after setting bot config", True)
        
        return True
        
    except Exception as e:
        log_test("GET /admin/dashboard/overview botConfigured", False, f"Exception: {e}")
        return False

def test_admin_guard_with_normal_user(normal_token: str):
    """
    Test 7a: All admin dashboard endpoints with normal (non-admin) user token
    Should all return HTTP 403
    """
    print("\n=== TEST 7a: Admin guard - all endpoints with normal user token ===")
    
    endpoints = [
        ("POST", "/admin/dashboard/session", {}),
        ("POST", "/admin/dashboard/verify", {"slug": "test", "code": "123456"}),
        ("GET", "/admin/dashboard/overview", None),
        ("GET", "/admin/dashboard/bot-config", None),
        ("POST", "/admin/dashboard/bot-config", {"discordBotToken": "test"}),
        ("POST", "/admin/dashboard/fulfill", {"orderId": "test"}),
    ]
    
    all_passed = True
    
    for method, endpoint, body in endpoints:
        try:
            if method == "GET":
                response = requests.get(
                    f"{BASE_URL}{endpoint}",
                    headers={"Authorization": f"Bearer {normal_token}"},
                    timeout=30
                )
            else:
                response = requests.post(
                    f"{BASE_URL}{endpoint}",
                    headers={"Authorization": f"Bearer {normal_token}"},
                    json=body,
                    timeout=30
                )
            
            if response.status_code != 403:
                log_test(f"{method} {endpoint} with normal user returns HTTP 403", False, 
                        f"Expected 403, got {response.status_code}")
                all_passed = False
            else:
                log_test(f"{method} {endpoint} with normal user returns HTTP 403", True)
                
        except Exception as e:
            log_test(f"{method} {endpoint} with normal user", False, f"Exception: {e}")
            all_passed = False
    
    return all_passed

def test_admin_guard_without_auth():
    """
    Test 7b: All admin dashboard endpoints without Authorization header
    Should all return HTTP 403
    """
    print("\n=== TEST 7b: Admin guard - all endpoints without Authorization header ===")
    
    endpoints = [
        ("POST", "/admin/dashboard/session", {}),
        ("POST", "/admin/dashboard/verify", {"slug": "test", "code": "123456"}),
        ("GET", "/admin/dashboard/overview", None),
        ("GET", "/admin/dashboard/bot-config", None),
        ("POST", "/admin/dashboard/bot-config", {"discordBotToken": "test"}),
        ("POST", "/admin/dashboard/fulfill", {"orderId": "test"}),
    ]
    
    all_passed = True
    
    for method, endpoint, body in endpoints:
        try:
            if method == "GET":
                response = requests.get(
                    f"{BASE_URL}{endpoint}",
                    timeout=30
                )
            else:
                response = requests.post(
                    f"{BASE_URL}{endpoint}",
                    json=body,
                    timeout=30
                )
            
            if response.status_code != 403:
                log_test(f"{method} {endpoint} without auth returns HTTP 403", False, 
                        f"Expected 403, got {response.status_code}")
                all_passed = False
            else:
                log_test(f"{method} {endpoint} without auth returns HTTP 403", True)
                
        except Exception as e:
            log_test(f"{method} {endpoint} without auth", False, f"Exception: {e}")
            all_passed = False
    
    return all_passed

def test_regression_config():
    """
    Test 8a: GET /api/config regression
    Should return {cryptoConfigured:true, provider:'blockbee'}
    """
    print("\n=== TEST 8a: Regression - GET /api/config ===")
    try:
        response = requests.get(
            f"{BASE_URL}/config",
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /api/config returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        
        if data.get("cryptoConfigured") != True:
            log_test("cryptoConfigured is true", False, 
                    f"Expected true, got {data.get('cryptoConfigured')}")
            return False
        
        if data.get("provider") != "blockbee":
            log_test("provider is 'blockbee'", False, 
                    f"Expected 'blockbee', got '{data.get('provider')}'")
            return False
        
        log_test("GET /api/config returns {cryptoConfigured:true, provider:'blockbee'}", True)
        
        return True
        
    except Exception as e:
        log_test("GET /api/config regression", False, f"Exception: {e}")
        return False

def test_regression_checkout_eligibility():
    """
    Test 8b: GET /api/checkout/eligibility?userId=156 regression
    Should return eligibility.tradesChecked===true
    """
    print("\n=== TEST 8b: Regression - GET /api/checkout/eligibility ===")
    try:
        response = requests.get(
            f"{BASE_URL}/checkout/eligibility?userId=156",
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("GET /api/checkout/eligibility returns HTTP 200", False, 
                    f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        eligibility = data.get("eligibility", {})
        
        if eligibility.get("tradesChecked") != True:
            log_test("eligibility.tradesChecked is true", False, 
                    f"Expected true, got {eligibility.get('tradesChecked')}")
            return False
        
        log_test("GET /api/checkout/eligibility?userId=156 returns eligibility.tradesChecked===true", True)
        
        return True
        
    except Exception as e:
        log_test("GET /api/checkout/eligibility regression", False, f"Exception: {e}")
        return False

def main():
    """Main test execution"""
    print("=" * 80)
    print("BACKEND API TESTING - UPDATE 14: Secret Discord Dashboard")
    print("=" * 80)
    
    # Step 1: Admin login
    print("\n=== SETUP: Admin Login ===")
    admin_token = admin_login()
    if not admin_token:
        print("\n✗ CRITICAL: Admin login failed. Cannot proceed with tests.")
        sys.exit(1)
    
    # Test 1: Create session code
    code, secret_slug, url = test_dashboard_session_create(admin_token)
    if not code or not secret_slug:
        print("\n✗ CRITICAL: Failed to create session code. Cannot proceed with verify tests.")
    else:
        # Test 2: Verify with correct slug and code
        verify_success = test_dashboard_verify_success(admin_token, secret_slug, code)
        
        if verify_success:
            # Test 3: Verify again with same code (should fail - single-use)
            test_dashboard_verify_single_use(admin_token, secret_slug, code)
        
        # Test 4: Create fresh session and test wrong code/slug
        print("\n=== Creating fresh session for wrong code/slug tests ===")
        fresh_code, fresh_slug, _ = test_dashboard_session_create(admin_token)
        
        if fresh_code and fresh_slug:
            # Test 4a: Wrong code
            test_dashboard_verify_wrong_code(admin_token, fresh_slug)
            
            # Test 4b: Wrong slug
            test_dashboard_verify_wrong_slug(admin_token, fresh_code)
    
    # Test 5: Dashboard overview
    test_dashboard_overview(admin_token)
    
    # Test 6: Bot config (GET, POST, GET again, overview again)
    initial_config = test_dashboard_bot_config_get(admin_token)
    
    if test_dashboard_bot_config_post(admin_token):
        test_dashboard_bot_config_verify(admin_token)
        test_dashboard_overview_bot_configured(admin_token)
    
    # Test 7: Admin guard
    print("\n=== SETUP: Signup normal user for admin guard tests ===")
    normal_token = signup_normal_user()
    
    if normal_token:
        test_admin_guard_with_normal_user(normal_token)
    else:
        print("✗ WARNING: Could not signup normal user. Skipping normal user guard tests.")
    
    test_admin_guard_without_auth()
    
    # Test 8: Regression tests
    test_regression_config()
    test_regression_checkout_eligibility()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {tests_passed + tests_failed}")
    print(f"✓ Passed: {tests_passed}")
    print(f"✗ Failed: {tests_failed}")
    print("=" * 80)
    
    if tests_failed == 0:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {tests_failed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()

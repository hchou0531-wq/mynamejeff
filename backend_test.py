#!/usr/bin/env python3
"""
Backend test for UPDATE 15: Dashboard nav + accounts/toy codes + /claim delivery
Tests all admin dashboard endpoints for digital goods (accounts/toycodes) CRUD, assign, bot config, and Discord claim/interactions.
"""

import requests
import json
import os
import sys

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://git-preview-roblox.preview.emergentagent.com')
API_URL = f"{BASE_URL}/api"

# Admin credentials
ADMIN_EMAIL = "admin@robloot.com"
ADMIN_PASSWORD = "roblootdevtomo"

# Test counters
tests_passed = 0
tests_failed = 0

def log_test(test_name, passed, details=""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✓ PASSED: {test_name}")
        if details:
            print(f"  {details}")
    else:
        tests_failed += 1
        print(f"✗ FAILED: {test_name}")
        if details:
            print(f"  {details}")

def test_update_15():
    print("\n" + "="*80)
    print("UPDATE 15 BACKEND TESTING: Digital Goods + Discord Claim + Bot Config")
    print("="*80 + "\n")

    # ========== STEP 1: Admin Login ==========
    print("\n[STEP 1] Admin Login")
    try:
        resp = requests.post(f"{API_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            admin_token = data.get('token')
            is_admin = data.get('user', {}).get('isAdmin', False)
            
            if admin_token and is_admin:
                log_test("Admin login successful", True, f"Token received, isAdmin={is_admin}")
            else:
                log_test("Admin login successful", False, f"Token or isAdmin missing: token={bool(admin_token)}, isAdmin={is_admin}")
                return
        else:
            log_test("Admin login successful", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
            return
    except Exception as e:
        log_test("Admin login successful", False, f"Exception: {str(e)}")
        return

    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # ========== STEP 2: TOY CODES - CREATE ==========
    print("\n[STEP 2] Toy Codes - Create")
    
    # Positive test: Create toycode with all required fields
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/toycodes", 
            headers=admin_headers,
            json={
                "title": "TC1",
                "code": "AAA-BBB-CCC",
                "price": 5
            }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            toycode = data.get('toycode', {})
            toycode_id = toycode.get('id')
            toycode_status = toycode.get('status')
            toycode_code = toycode.get('code')
            
            if toycode_id and toycode_status == 'available' and toycode_code == 'AAA-BBB-CCC':
                log_test("POST /admin/dashboard/toycodes (valid)", True, 
                    f"Created toycode id={toycode_id}, status={toycode_status}, code={toycode_code}")
            else:
                log_test("POST /admin/dashboard/toycodes (valid)", False, 
                    f"Missing fields or wrong values: id={toycode_id}, status={toycode_status}, code={toycode_code}")
        else:
            log_test("POST /admin/dashboard/toycodes (valid)", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/toycodes (valid)", False, f"Exception: {str(e)}")
        toycode_id = None

    # Negative test: Create toycode without code
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/toycodes", 
            headers=admin_headers,
            json={
                "title": "x"
            }, timeout=30)
        
        if resp.status_code == 400:
            log_test("POST /admin/dashboard/toycodes (no code) -> 400", True, f"Correctly returned 400")
        else:
            log_test("POST /admin/dashboard/toycodes (no code) -> 400", False, 
                f"Expected 400, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/toycodes (no code) -> 400", False, f"Exception: {str(e)}")

    # ========== STEP 3: ACCOUNTS - CREATE ==========
    print("\n[STEP 3] Accounts - Create")
    
    # Positive test: Create account with all required fields
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/accounts", 
            headers=admin_headers,
            json={
                "title": "Acc1",
                "username": "u1",
                "password": "p1",
                "email": "e@x.com",
                "price": 10
            }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            account = data.get('account', {})
            account_id = account.get('id')
            account_status = account.get('status')
            credentials = account.get('credentials', {})
            
            if account_id and account_status == 'available' and credentials.get('username') == 'u1' and credentials.get('password') == 'p1':
                log_test("POST /admin/dashboard/accounts (valid)", True, 
                    f"Created account id={account_id}, status={account_status}, username={credentials.get('username')}")
            else:
                log_test("POST /admin/dashboard/accounts (valid)", False, 
                    f"Missing fields or wrong values: id={account_id}, status={account_status}, credentials={credentials}")
        else:
            log_test("POST /admin/dashboard/accounts (valid)", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/accounts (valid)", False, f"Exception: {str(e)}")
        account_id = None

    # Negative test: Create account without username/password
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/accounts", 
            headers=admin_headers,
            json={
                "title": "x"
            }, timeout=30)
        
        if resp.status_code == 400:
            log_test("POST /admin/dashboard/accounts (no username/password) -> 400", True, f"Correctly returned 400")
        else:
            log_test("POST /admin/dashboard/accounts (no username/password) -> 400", False, 
                f"Expected 400, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/accounts (no username/password) -> 400", False, f"Exception: {str(e)}")

    # ========== STEP 4: LISTS - GET toycodes and accounts ==========
    print("\n[STEP 4] Lists - GET toycodes and accounts")
    
    # GET toycodes
    try:
        resp = requests.get(f"{API_URL}/admin/dashboard/toycodes", 
            headers=admin_headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            toycodes = data.get('toycodes', [])
            tc1_found = any(tc.get('code') == 'AAA-BBB-CCC' for tc in toycodes)
            
            if tc1_found:
                log_test("GET /admin/dashboard/toycodes", True, f"Found TC1 in {len(toycodes)} toycodes")
            else:
                log_test("GET /admin/dashboard/toycodes", False, f"TC1 not found in {len(toycodes)} toycodes")
        else:
            log_test("GET /admin/dashboard/toycodes", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /admin/dashboard/toycodes", False, f"Exception: {str(e)}")

    # GET accounts
    try:
        resp = requests.get(f"{API_URL}/admin/dashboard/accounts", 
            headers=admin_headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            accounts = data.get('accounts', [])
            acc1_found = any(acc.get('title') == 'Acc1' for acc in accounts)
            
            if acc1_found:
                log_test("GET /admin/dashboard/accounts", True, f"Found Acc1 in {len(accounts)} accounts")
            else:
                log_test("GET /admin/dashboard/accounts", False, f"Acc1 not found in {len(accounts)} accounts")
        else:
            log_test("GET /admin/dashboard/accounts", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /admin/dashboard/accounts", False, f"Exception: {str(e)}")

    # ========== STEP 5: ASSIGN - Assign toycode to order ==========
    print("\n[STEP 5] Assign - Assign toycode to order")
    
    if toycode_id:
        # Positive test: Assign toycode to order
        try:
            resp = requests.post(f"{API_URL}/admin/dashboard/assign", 
                headers=admin_headers,
                json={
                    "type": "toycode",
                    "id": toycode_id,
                    "orderNumber": "5555"
                }, timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                if data.get('success'):
                    log_test("POST /admin/dashboard/assign (valid)", True, f"Successfully assigned toycode to order 5555")
                    
                    # Verify the assignment by getting toycodes
                    resp2 = requests.get(f"{API_URL}/admin/dashboard/toycodes", 
                        headers=admin_headers, timeout=30)
                    
                    if resp2.status_code == 200:
                        toycodes = resp2.json().get('toycodes', [])
                        assigned_tc = next((tc for tc in toycodes if tc.get('id') == toycode_id), None)
                        
                        if assigned_tc and assigned_tc.get('status') == 'sold' and assigned_tc.get('claimOrderNumber') == '5555':
                            log_test("Verify toycode assignment", True, 
                                f"Toycode status=sold, claimOrderNumber=5555")
                        else:
                            log_test("Verify toycode assignment", False, 
                                f"Status or claimOrderNumber mismatch: {assigned_tc}")
                    else:
                        log_test("Verify toycode assignment", False, f"Failed to GET toycodes: HTTP {resp2.status_code}")
                else:
                    log_test("POST /admin/dashboard/assign (valid)", False, f"success=false in response")
            else:
                log_test("POST /admin/dashboard/assign (valid)", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log_test("POST /admin/dashboard/assign (valid)", False, f"Exception: {str(e)}")
    else:
        log_test("POST /admin/dashboard/assign (valid)", False, "Skipped - no toycode_id available")

    # Negative test: Assign with missing fields
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/assign", 
            headers=admin_headers,
            json={
                "type": "toycode"
            }, timeout=30)
        
        if resp.status_code == 400:
            log_test("POST /admin/dashboard/assign (missing fields) -> 400", True, f"Correctly returned 400")
        else:
            log_test("POST /admin/dashboard/assign (missing fields) -> 400", False, 
                f"Expected 400, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/assign (missing fields) -> 400", False, f"Exception: {str(e)}")

    # Negative test: Assign with nonexistent id
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/assign", 
            headers=admin_headers,
            json={
                "type": "toycode",
                "id": "nonexistent-id-12345",
                "orderNumber": "1"
            }, timeout=30)
        
        if resp.status_code == 404:
            log_test("POST /admin/dashboard/assign (nonexistent id) -> 404", True, f"Correctly returned 404")
        else:
            log_test("POST /admin/dashboard/assign (nonexistent id) -> 404", False, 
                f"Expected 404, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/assign (nonexistent id) -> 404", False, f"Exception: {str(e)}")

    # ========== STEP 6: DELETE - Delete account ==========
    print("\n[STEP 6] Delete - Delete account")
    
    if account_id:
        try:
            resp = requests.delete(f"{API_URL}/admin/dashboard/accounts/{account_id}", 
                headers=admin_headers, timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                if data.get('success'):
                    log_test("DELETE /admin/dashboard/accounts/:id", True, f"Successfully deleted account {account_id}")
                    
                    # Verify deletion by getting accounts
                    resp2 = requests.get(f"{API_URL}/admin/dashboard/accounts", 
                        headers=admin_headers, timeout=30)
                    
                    if resp2.status_code == 200:
                        accounts = resp2.json().get('accounts', [])
                        deleted_acc = next((acc for acc in accounts if acc.get('id') == account_id), None)
                        
                        if not deleted_acc:
                            log_test("Verify account deletion", True, f"Account {account_id} not found in list (deleted)")
                        else:
                            log_test("Verify account deletion", False, f"Account {account_id} still exists after deletion")
                    else:
                        log_test("Verify account deletion", False, f"Failed to GET accounts: HTTP {resp2.status_code}")
                else:
                    log_test("DELETE /admin/dashboard/accounts/:id", False, f"success=false in response")
            else:
                log_test("DELETE /admin/dashboard/accounts/:id", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log_test("DELETE /admin/dashboard/accounts/:id", False, f"Exception: {str(e)}")
    else:
        log_test("DELETE /admin/dashboard/accounts/:id", False, "Skipped - no account_id available")

    # ========== STEP 7: BOT ONLINE - Set bot online and get overview ==========
    print("\n[STEP 7] Bot Online - Set bot online and get overview")
    
    # Set botOnline to true
    try:
        resp = requests.post(f"{API_URL}/admin/dashboard/bot-config", 
            headers=admin_headers,
            json={
                "botOnline": True
            }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get('success'):
                log_test("POST /admin/dashboard/bot-config (botOnline=true)", True, f"Successfully set botOnline=true")
            else:
                log_test("POST /admin/dashboard/bot-config (botOnline=true)", False, f"success=false in response")
        else:
            log_test("POST /admin/dashboard/bot-config (botOnline=true)", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /admin/dashboard/bot-config (botOnline=true)", False, f"Exception: {str(e)}")

    # Get overview and verify botOnline and stats
    try:
        resp = requests.get(f"{API_URL}/admin/dashboard/overview", 
            headers=admin_headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            bot_online = data.get('botOnline')
            stats = data.get('stats', {})
            accounts_count = stats.get('accounts')
            toycodes_count = stats.get('toycodes')
            
            if bot_online == True:
                log_test("GET /admin/dashboard/overview (botOnline)", True, f"botOnline={bot_online}")
            else:
                log_test("GET /admin/dashboard/overview (botOnline)", False, f"botOnline={bot_online}, expected True")
            
            if isinstance(accounts_count, (int, float)) and isinstance(toycodes_count, (int, float)):
                log_test("GET /admin/dashboard/overview (stats)", True, 
                    f"stats.accounts={accounts_count}, stats.toycodes={toycodes_count}")
            else:
                log_test("GET /admin/dashboard/overview (stats)", False, 
                    f"stats.accounts={accounts_count} (type={type(accounts_count)}), stats.toycodes={toycodes_count} (type={type(toycodes_count)})")
        else:
            log_test("GET /admin/dashboard/overview", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /admin/dashboard/overview", False, f"Exception: {str(e)}")

    # ========== STEP 8: CLAIM AUTH - Negative tests only ==========
    print("\n[STEP 8] Claim Auth - Negative tests (wrong/missing secret)")
    
    # Test with wrong secret
    try:
        resp = requests.post(f"{API_URL}/discord/claim", 
            headers={"x-bot-secret": "WRONG"},
            json={
                "orderNumber": "5555"
            }, timeout=30)
        
        if resp.status_code == 401:
            log_test("POST /discord/claim (wrong secret) -> 401", True, f"Correctly returned 401")
        else:
            log_test("POST /discord/claim (wrong secret) -> 401", False, 
                f"Expected 401, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /discord/claim (wrong secret) -> 401", False, f"Exception: {str(e)}")

    # Test with no secret header
    try:
        resp = requests.post(f"{API_URL}/discord/claim", 
            json={
                "orderNumber": "5555"
            }, timeout=30)
        
        if resp.status_code == 401:
            log_test("POST /discord/claim (no secret) -> 401", True, f"Correctly returned 401")
        else:
            log_test("POST /discord/claim (no secret) -> 401", False, 
                f"Expected 401, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /discord/claim (no secret) -> 401", False, f"Exception: {str(e)}")

    # ========== STEP 9: DISCORD WEBHOOK - Test without signature ==========
    print("\n[STEP 9] Discord Webhook - Test without signature")
    
    try:
        resp = requests.post(f"{API_URL}/discord/interactions", 
            json={
                "type": 1
            }, timeout=30)
        
        if resp.status_code == 503:
            log_test("POST /discord/interactions (no signature) -> 503", True, 
                f"Correctly returned 503 (DISCORD_PUBLIC_KEY not configured)")
        else:
            log_test("POST /discord/interactions (no signature) -> 503", False, 
                f"Expected 503, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /discord/interactions (no signature) -> 503", False, f"Exception: {str(e)}")

    # ========== STEP 10: ADMIN GUARD - Test with non-admin user ==========
    print("\n[STEP 10] Admin Guard - Test with non-admin user")
    
    # Signup a normal user
    try:
        import random
        random_num = random.randint(10000, 99999)
        normal_email = f"normaluser{random_num}@test.com"
        normal_username = f"normaluser{random_num}"
        resp = requests.post(f"{API_URL}/auth/signup", json={
            "username": normal_username,
            "email": normal_email,
            "password": "testpass123"
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            normal_token = data.get('token')
            is_admin = data.get('user', {}).get('isAdmin', False)
            
            if normal_token and not is_admin:
                log_test("Normal user signup", True, f"Token received, isAdmin={is_admin}")
            else:
                log_test("Normal user signup", False, f"Token or isAdmin issue: token={bool(normal_token)}, isAdmin={is_admin}")
                normal_token = None
        else:
            log_test("Normal user signup", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
            normal_token = None
    except Exception as e:
        log_test("Normal user signup", False, f"Exception: {str(e)}")
        normal_token = None

    if normal_token:
        normal_headers = {"Authorization": f"Bearer {normal_token}"}
        
        # Test all admin endpoints with normal user token
        admin_endpoints = [
            ("POST", "/admin/dashboard/toycodes", {"title": "x", "code": "y"}),
            ("POST", "/admin/dashboard/accounts", {"title": "x", "username": "y", "password": "z"}),
            ("GET", "/admin/dashboard/toycodes", None),
            ("GET", "/admin/dashboard/accounts", None),
            ("POST", "/admin/dashboard/assign", {"type": "toycode", "id": "x", "orderNumber": "1"}),
            ("DELETE", "/admin/dashboard/accounts/anyid", None),
        ]
        
        for method, endpoint, body in admin_endpoints:
            try:
                if method == "POST":
                    resp = requests.post(f"{API_URL}{endpoint}", headers=normal_headers, json=body, timeout=30)
                elif method == "GET":
                    resp = requests.get(f"{API_URL}{endpoint}", headers=normal_headers, timeout=30)
                elif method == "DELETE":
                    resp = requests.delete(f"{API_URL}{endpoint}", headers=normal_headers, timeout=30)
                
                if resp.status_code == 403:
                    log_test(f"{method} {endpoint} (non-admin) -> 403", True, f"Correctly returned 403")
                else:
                    log_test(f"{method} {endpoint} (non-admin) -> 403", False, 
                        f"Expected 403, got {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                log_test(f"{method} {endpoint} (non-admin) -> 403", False, f"Exception: {str(e)}")

        # Test with no auth header
        for method, endpoint, body in admin_endpoints:
            try:
                if method == "POST":
                    resp = requests.post(f"{API_URL}{endpoint}", json=body, timeout=30)
                elif method == "GET":
                    resp = requests.get(f"{API_URL}{endpoint}", timeout=30)
                elif method == "DELETE":
                    resp = requests.delete(f"{API_URL}{endpoint}", timeout=30)
                
                if resp.status_code == 403:
                    log_test(f"{method} {endpoint} (no auth) -> 403", True, f"Correctly returned 403")
                else:
                    log_test(f"{method} {endpoint} (no auth) -> 403", False, 
                        f"Expected 403, got {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                log_test(f"{method} {endpoint} (no auth) -> 403", False, f"Exception: {str(e)}")

    # ========== STEP 11: REGRESSION TESTS ==========
    print("\n[STEP 11] Regression Tests")
    
    # GET /api/config
    try:
        resp = requests.get(f"{API_URL}/config", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            crypto_configured = data.get('cryptoConfigured')
            provider = data.get('provider')
            
            if crypto_configured == True and provider == 'blockbee':
                log_test("GET /api/config", True, f"cryptoConfigured={crypto_configured}, provider={provider}")
            else:
                log_test("GET /api/config", False, 
                    f"cryptoConfigured={crypto_configured} (expected True), provider={provider} (expected 'blockbee')")
        else:
            log_test("GET /api/config", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /api/config", False, f"Exception: {str(e)}")

    # GET /api/reviews
    try:
        resp = requests.get(f"{API_URL}/reviews", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            sales_by_source = data.get('salesBySource')
            
            if sales_by_source and isinstance(sales_by_source, dict):
                log_test("GET /api/reviews", True, f"salesBySource present: {sales_by_source}")
            else:
                log_test("GET /api/reviews", False, f"salesBySource missing or wrong type: {sales_by_source}")
        else:
            log_test("GET /api/reviews", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /api/reviews", False, f"Exception: {str(e)}")

    # GET /api/checkout/eligibility
    try:
        resp = requests.get(f"{API_URL}/checkout/eligibility?userId=156", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            eligibility = data.get('eligibility', {})
            trades_checked = eligibility.get('tradesChecked')
            
            if trades_checked == True:
                log_test("GET /api/checkout/eligibility", True, f"tradesChecked={trades_checked}")
            else:
                log_test("GET /api/checkout/eligibility", False, f"tradesChecked={trades_checked} (expected True)")
        else:
            log_test("GET /api/checkout/eligibility", False, f"HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("GET /api/checkout/eligibility", False, f"Exception: {str(e)}")

    # ========== SUMMARY ==========
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total Tests: {tests_passed + tests_failed}")
    print(f"✓ Passed: {tests_passed}")
    print(f"✗ Failed: {tests_failed}")
    print("="*80 + "\n")

    if tests_failed == 0:
        print("🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"⚠️  {tests_failed} TEST(S) FAILED")
        return 1

if __name__ == "__main__":
    exit_code = test_update_15()
    sys.exit(exit_code)

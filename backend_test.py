#!/usr/bin/env python3
"""
Backend test for UPDATE 18: Discord bot "application did not respond" fix
Tests the bot-start endpoint auto-setting and verifying Discord interactions endpoint URL
"""

import requests
import json
import sys
import os

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://cookies-8.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    return passed

def test_admin_login():
    """Test admin login and get token"""
    print("\n=== TEST 1: Admin Login ===")
    try:
        response = requests.post(
            f"{API_BASE}/auth/login",
            json={"email": "admin@robloot.com", "password": "roblootdevtomo"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("Admin login", False, f"HTTP {response.status_code}: {response.text[:200]}")
        
        data = response.json()
        if not data.get('token'):
            return print_test("Admin login", False, "No token in response")
        
        if not data.get('user', {}).get('isAdmin'):
            return print_test("Admin login", False, "user.isAdmin is not true")
        
        print_test("Admin login", True, f"Token received, isAdmin=true")
        return data['token']
    except Exception as e:
        print_test("Admin login", False, f"Exception: {str(e)}")
        return None

def test_bot_start_first_call(admin_token):
    """Test POST /api/admin/dashboard/bot-start - first call"""
    print("\n=== TEST 2: POST /api/admin/dashboard/bot-start (First Call) ===")
    try:
        response = requests.post(
            f"{API_BASE}/admin/dashboard/bot-start",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=60  # Bot start can take time
        )
        
        if response.status_code != 200:
            return print_test("bot-start first call", False, f"HTTP {response.status_code}: {response.text[:500]}")
        
        data = response.json()
        
        # Check required fields
        if not isinstance(data.get('ok'), bool):
            return print_test("bot-start first call", False, "Missing 'ok' field")
        
        if 'errors' not in data:
            return print_test("bot-start first call", False, "Missing 'errors' field")
        
        if not isinstance(data.get('logs'), list):
            return print_test("bot-start first call", False, "Missing or invalid 'logs' field")
        
        # Check for interactions endpoint success log
        endpoint_log_found = False
        error_logs = []
        
        for log in data['logs']:
            if log.get('level') == 'error':
                error_logs.append(log.get('msg', ''))
            
            if log.get('level') == 'success' and 'Interactions endpoint' in log.get('msg', ''):
                msg = log.get('msg', '')
                if 'set AND verified by Discord' in msg or 'already set' in msg:
                    endpoint_log_found = True
        
        if error_logs:
            return print_test("bot-start first call", False, f"Found error logs: {error_logs}")
        
        if not endpoint_log_found:
            return print_test("bot-start first call", False, "No success log about 'Interactions endpoint' found")
        
        # Check for other expected success logs
        expected_keywords = ['Authenticated as', 'Registered', 'Channel']
        found_keywords = []
        for keyword in expected_keywords:
            for log in data['logs']:
                if log.get('level') == 'success' and keyword in log.get('msg', ''):
                    found_keywords.append(keyword)
                    break
        
        print_test("bot-start first call", True, 
                  f"ok={data['ok']}, errors={data['errors']}, logs={len(data['logs'])}, "
                  f"endpoint_log_found=True, found_keywords={found_keywords}")
        return True
    except Exception as e:
        print_test("bot-start first call", False, f"Exception: {str(e)}")
        return False

def test_bot_start_idempotency(admin_token):
    """Test POST /api/admin/dashboard/bot-start - idempotency (second call)"""
    print("\n=== TEST 3: POST /api/admin/dashboard/bot-start (Idempotency) ===")
    try:
        response = requests.post(
            f"{API_BASE}/admin/dashboard/bot-start",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=60
        )
        
        if response.status_code != 200:
            return print_test("bot-start idempotency", False, f"HTTP {response.status_code}: {response.text[:500]}")
        
        data = response.json()
        
        if not data.get('ok'):
            return print_test("bot-start idempotency", False, f"ok={data.get('ok')}")
        
        # Check that endpoint log now says "already set"
        already_set_found = False
        for log in data.get('logs', []):
            if log.get('level') == 'success' and 'Interactions endpoint' in log.get('msg', ''):
                if 'already set' in log.get('msg', ''):
                    already_set_found = True
        
        if not already_set_found:
            return print_test("bot-start idempotency", False, 
                            "Expected 'already set' in interactions endpoint log")
        
        print_test("bot-start idempotency", True, "ok=true, endpoint shows 'already set'")
        return True
    except Exception as e:
        print_test("bot-start idempotency", False, f"Exception: {str(e)}")
        return False

def test_bot_status(admin_token):
    """Test GET /api/admin/dashboard/bot-status"""
    print("\n=== TEST 4: GET /api/admin/dashboard/bot-status ===")
    try:
        response = requests.get(
            f"{API_BASE}/admin/dashboard/bot-status",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("bot-status", False, f"HTTP {response.status_code}: {response.text[:500]}")
        
        data = response.json()
        
        # Check all required fields
        checks = []
        
        # endpointConfigured should be true
        if data.get('endpointConfigured') != True:
            checks.append(f"endpointConfigured={data.get('endpointConfigured')} (expected true)")
        
        # currentEndpoint should end with /api/discord/interactions
        current_endpoint = data.get('currentEndpoint', '')
        if not current_endpoint.endswith('/api/discord/interactions'):
            checks.append(f"currentEndpoint doesn't end with /api/discord/interactions: {current_endpoint}")
        
        # commands should be an array containing both 'claim' and 'embed'
        commands = data.get('commands', [])
        if not isinstance(commands, list):
            checks.append(f"commands is not an array: {type(commands)}")
        elif 'claim' not in commands:
            checks.append(f"'claim' not in commands: {commands}")
        elif 'embed' not in commands:
            checks.append(f"'embed' not in commands: {commands}")
        
        # commandsRegistered should be true
        if data.get('commandsRegistered') != True:
            checks.append(f"commandsRegistered={data.get('commandsRegistered')} (expected true)")
        
        # publicKeySet should be true
        if data.get('publicKeySet') != True:
            checks.append(f"publicKeySet={data.get('publicKeySet')} (expected true)")
        
        # tokenValid should be true
        if data.get('tokenValid') != True:
            checks.append(f"tokenValid={data.get('tokenValid')} (expected true)")
        
        # ready should be true
        if data.get('ready') != True:
            checks.append(f"ready={data.get('ready')} (expected true)")
        
        if checks:
            return print_test("bot-status", False, f"Failed checks: {', '.join(checks)}")
        
        print_test("bot-status", True, 
                  f"endpointConfigured=true, currentEndpoint={current_endpoint}, "
                  f"commands={commands}, commandsRegistered=true, publicKeySet=true, "
                  f"tokenValid=true, ready=true")
        return True
    except Exception as e:
        print_test("bot-status", False, f"Exception: {str(e)}")
        return False

def test_bot_start_no_auth():
    """Test POST /api/admin/dashboard/bot-start without Authorization header"""
    print("\n=== TEST 5: POST /api/admin/dashboard/bot-start (No Auth) ===")
    try:
        response = requests.post(
            f"{API_BASE}/admin/dashboard/bot-start",
            timeout=30
        )
        
        if response.status_code != 403:
            return print_test("bot-start no auth", False, 
                            f"Expected HTTP 403, got {response.status_code}")
        
        print_test("bot-start no auth", True, "HTTP 403 as expected")
        return True
    except Exception as e:
        print_test("bot-start no auth", False, f"Exception: {str(e)}")
        return False

def test_bot_start_non_admin(non_admin_token):
    """Test POST /api/admin/dashboard/bot-start with non-admin user token"""
    print("\n=== TEST 6: POST /api/admin/dashboard/bot-start (Non-Admin User) ===")
    try:
        response = requests.post(
            f"{API_BASE}/admin/dashboard/bot-start",
            headers={"Authorization": f"Bearer {non_admin_token}"},
            timeout=30
        )
        
        if response.status_code != 403:
            return print_test("bot-start non-admin", False, 
                            f"Expected HTTP 403, got {response.status_code}")
        
        print_test("bot-start non-admin", True, "HTTP 403 as expected")
        return True
    except Exception as e:
        print_test("bot-start non-admin", False, f"Exception: {str(e)}")
        return False

def test_config_regression():
    """Test GET /api/config regression"""
    print("\n=== TEST 7: GET /api/config (Regression) ===")
    try:
        response = requests.get(f"{API_BASE}/config", timeout=30)
        
        if response.status_code != 200:
            return print_test("config regression", False, f"HTTP {response.status_code}")
        
        data = response.json()
        
        if data.get('cryptoConfigured') != True:
            return print_test("config regression", False, 
                            f"cryptoConfigured={data.get('cryptoConfigured')} (expected true)")
        
        print_test("config regression", True, f"cryptoConfigured=true")
        return True
    except Exception as e:
        print_test("config regression", False, f"Exception: {str(e)}")
        return False

def test_embeds_crud(admin_token):
    """Test embeds CRUD regression"""
    print("\n=== TEST 8: Embeds CRUD (Regression) ===")
    
    # Create embed
    print("  8a. Creating embed...")
    try:
        response = requests.post(
            f"{API_BASE}/admin/dashboard/embeds",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "t18", "title": "hi", "description": "d"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("embeds create", False, f"HTTP {response.status_code}: {response.text[:200]}")
        
        data = response.json()
        embed_id = data.get('embed', {}).get('id')
        
        if not embed_id:
            return print_test("embeds create", False, "No embed id in response")
        
        print(f"    Created embed with id: {embed_id}")
    except Exception as e:
        return print_test("embeds create", False, f"Exception: {str(e)}")
    
    # List embeds
    print("  8b. Listing embeds...")
    try:
        response = requests.get(
            f"{API_BASE}/admin/dashboard/embeds",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("embeds list", False, f"HTTP {response.status_code}")
        
        data = response.json()
        embeds = data.get('embeds', [])
        
        found = False
        for embed in embeds:
            if embed.get('id') == embed_id:
                found = True
                break
        
        if not found:
            return print_test("embeds list", False, f"Created embed {embed_id} not found in list")
        
        print(f"    Found embed in list (total: {len(embeds)})")
    except Exception as e:
        return print_test("embeds list", False, f"Exception: {str(e)}")
    
    # Delete embed
    print("  8c. Deleting embed...")
    try:
        response = requests.delete(
            f"{API_BASE}/admin/dashboard/embeds/{embed_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("embeds delete", False, f"HTTP {response.status_code}")
        
        print(f"    Deleted embed {embed_id}")
    except Exception as e:
        return print_test("embeds delete", False, f"Exception: {str(e)}")
    
    # Verify deletion
    print("  8d. Verifying deletion...")
    try:
        response = requests.get(
            f"{API_BASE}/admin/dashboard/embeds",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if response.status_code != 200:
            return print_test("embeds verify deletion", False, f"HTTP {response.status_code}")
        
        data = response.json()
        embeds = data.get('embeds', [])
        
        for embed in embeds:
            if embed.get('id') == embed_id:
                return print_test("embeds verify deletion", False, 
                                f"Embed {embed_id} still exists after deletion")
        
        print(f"    Verified embed is gone")
    except Exception as e:
        return print_test("embeds verify deletion", False, f"Exception: {str(e)}")
    
    print_test("embeds CRUD regression", True, "Create, list, delete all working")
    return True

def create_non_admin_user():
    """Create a non-admin user for testing"""
    print("\n=== Creating Non-Admin User ===")
    try:
        import random
        username = f"testuser{random.randint(10000, 99999)}"
        email = f"{username}@test.com"
        password = "testpass123"
        
        response = requests.post(
            f"{API_BASE}/auth/signup",
            json={"username": username, "email": email, "password": password},
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"  Failed to create non-admin user: HTTP {response.status_code}")
            return None
        
        data = response.json()
        token = data.get('token')
        
        if not token:
            print(f"  No token in signup response")
            return None
        
        print(f"  Created non-admin user: {username}")
        return token
    except Exception as e:
        print(f"  Exception creating non-admin user: {str(e)}")
        return None

def main():
    print("=" * 80)
    print("UPDATE 18 BACKEND TEST: Discord Bot 'Application Did Not Respond' Fix")
    print("Testing bot-start endpoint auto-setting Discord interactions endpoint URL")
    print("=" * 80)
    
    results = []
    
    # Test 1: Admin login
    admin_token = test_admin_login()
    if not admin_token:
        print("\n❌ CRITICAL: Admin login failed. Cannot continue tests.")
        sys.exit(1)
    results.append(True)
    
    # Test 2: bot-start first call
    results.append(test_bot_start_first_call(admin_token))
    
    # Test 3: bot-start idempotency
    results.append(test_bot_start_idempotency(admin_token))
    
    # Test 4: bot-status
    results.append(test_bot_status(admin_token))
    
    # Test 5: bot-start no auth
    results.append(test_bot_start_no_auth())
    
    # Create non-admin user for test 6
    non_admin_token = create_non_admin_user()
    if non_admin_token:
        # Test 6: bot-start non-admin
        results.append(test_bot_start_non_admin(non_admin_token))
    else:
        print("\n⚠️  WARNING: Could not create non-admin user, skipping non-admin test")
        results.append(False)
    
    # Test 7: config regression
    results.append(test_config_regression())
    
    # Test 8: embeds CRUD regression
    results.append(test_embeds_crud(admin_token))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()

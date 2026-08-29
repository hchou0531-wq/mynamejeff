#!/usr/bin/env python3
"""
Backend test for UPDATE 16: Discord Embeds + bot-status endpoints
Tests all CRUD operations, guards, bot status, register commands, post-to-channel, and interactions key check
"""

import requests
import json
import sys

# Base URL from .env
BASE_URL = "https://cookies-8.preview.emergentagent.com/api"

# Admin credentials
ADMIN_EMAIL = "admin@robloot.com"
ADMIN_PASSWORD = "roblootdevtomo"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")
    print()

def main():
    print("=" * 80)
    print("UPDATE 16 BACKEND TESTING: Discord Embeds + bot-status")
    print("=" * 80)
    print()
    
    # Store test results
    results = {
        "total": 0,
        "passed": 0,
        "failed": 0
    }
    
    # ========== TEST 1: Admin Login ==========
    print("TEST 1: Admin Login")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        admin_token = None
        if response.status_code == 200:
            data = response.json()
            admin_token = data.get("token")
            is_admin = data.get("user", {}).get("isAdmin")
            if admin_token and is_admin:
                print_test("Admin login", True, f"Token received, isAdmin={is_admin}")
                results["passed"] += 1
            else:
                print_test("Admin login", False, f"Token or isAdmin missing: {data}")
                results["failed"] += 1
        else:
            print_test("Admin login", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
            return results
    except Exception as e:
        print_test("Admin login", False, f"Exception: {e}")
        results["failed"] += 1
        return results
    
    # ========== TEST 2: Signup Normal User ==========
    print("TEST 2: Signup Normal User")
    results["total"] += 1
    try:
        import random
        username = f"testuser{random.randint(10000, 99999)}"
        response = requests.post(f"{BASE_URL}/auth/signup", json={
            "username": username,
            "email": f"{username}@test.com",
            "password": "testpass123"
        })
        normal_token = None
        if response.status_code == 200:
            data = response.json()
            normal_token = data.get("token")
            if normal_token:
                print_test("Normal user signup", True, f"Token received for {username}")
                results["passed"] += 1
            else:
                print_test("Normal user signup", False, f"Token missing: {data}")
                results["failed"] += 1
        else:
            print_test("Normal user signup", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("Normal user signup", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 3: EMBEDS CRUD - Create embed with valid data ==========
    print("TEST 3: Create embed with valid data (admin)")
    results["total"] += 1
    embed_id = None
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "welcome",
                "title": "Hi",
                "description": "desc",
                "color": "#22c55e",
                "fields": [{"name": "a", "value": "b", "inline": True}]
            })
        if response.status_code == 200:
            data = response.json()
            embed = data.get("embed", {})
            embed_id = embed.get("id")
            if embed_id and embed.get("name") == "welcome" and embed.get("title") == "Hi":
                print_test("Create embed", True, f"Embed created with id={embed_id}, name=welcome, title=Hi")
                results["passed"] += 1
            else:
                print_test("Create embed", False, f"Missing id or incorrect data: {data}")
                results["failed"] += 1
        else:
            print_test("Create embed", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("Create embed", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 4: Create embed without name (should fail) ==========
    print("TEST 4: Create embed without name (should return 400)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"title": "x"})
        if response.status_code == 400:
            print_test("Create embed without name", True, f"Correctly returned 400: {response.json()}")
            results["passed"] += 1
        else:
            print_test("Create embed without name", False, f"Expected 400, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("Create embed without name", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 5: Create embed with name but no title AND no description (should fail) ==========
    print("TEST 5: Create embed with name but no title AND no description (should return 400)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "nofields"})
        if response.status_code == 400:
            print_test("Create embed without title/description", True, f"Correctly returned 400: {response.json()}")
            results["passed"] += 1
        else:
            print_test("Create embed without title/description", False, f"Expected 400, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("Create embed without title/description", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 6: GET embeds (should include welcome) ==========
    print("TEST 6: GET embeds (should include welcome)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"})
        if response.status_code == 200:
            data = response.json()
            embeds = data.get("embeds", [])
            welcome_embed = next((e for e in embeds if e.get("name") == "welcome"), None)
            if welcome_embed:
                print_test("GET embeds", True, f"Found welcome embed in array of {len(embeds)} embeds")
                results["passed"] += 1
            else:
                print_test("GET embeds", False, f"Welcome embed not found in {len(embeds)} embeds")
                results["failed"] += 1
        else:
            print_test("GET embeds", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("GET embeds", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 7: UPSERT-BY-NAME - Re-POST with same name (should edit, not duplicate) ==========
    print("TEST 7: UPSERT-BY-NAME - Re-POST with same name 'welcome'")
    results["total"] += 1
    try:
        # Get count before
        response = requests.get(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"})
        before_count = len([e for e in response.json().get("embeds", []) if e.get("name", "").lower() == "welcome"])
        
        # Re-POST with same name but different title
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "welcome", "title": "Edited"})
        
        if response.status_code == 200:
            # Get count after
            response = requests.get(f"{BASE_URL}/admin/dashboard/embeds", 
                headers={"Authorization": f"Bearer {admin_token}"})
            embeds = response.json().get("embeds", [])
            after_count = len([e for e in embeds if e.get("name", "").lower() == "welcome"])
            welcome_embed = next((e for e in embeds if e.get("name", "").lower() == "welcome"), None)
            
            if after_count == before_count and welcome_embed and welcome_embed.get("title") == "Edited":
                print_test("UPSERT-BY-NAME", True, f"Count unchanged ({before_count}), title updated to 'Edited'")
                results["passed"] += 1
            else:
                print_test("UPSERT-BY-NAME", False, f"Count before={before_count}, after={after_count}, title={welcome_embed.get('title') if welcome_embed else 'N/A'}")
                results["failed"] += 1
        else:
            print_test("UPSERT-BY-NAME", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("UPSERT-BY-NAME", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 8: EDIT-BY-ID - POST with id (should edit by id) ==========
    print("TEST 8: EDIT-BY-ID - POST with id")
    results["total"] += 1
    try:
        if embed_id:
            response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"id": embed_id, "name": "welcome", "title": "ById", "description": "desc"})
            
            if response.status_code == 200:
                data = response.json()
                embed = data.get("embed", {})
                if embed.get("title") == "ById":
                    print_test("EDIT-BY-ID", True, f"Title updated to 'ById' for id={embed_id}")
                    results["passed"] += 1
                else:
                    print_test("EDIT-BY-ID", False, f"Title not updated: {embed.get('title')}")
                    results["failed"] += 1
            else:
                print_test("EDIT-BY-ID", False, f"HTTP {response.status_code}: {response.text}")
                results["failed"] += 1
        else:
            print_test("EDIT-BY-ID", False, "No embed_id available from previous test")
            results["failed"] += 1
    except Exception as e:
        print_test("EDIT-BY-ID", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 9: DELETE embed ==========
    print("TEST 9: DELETE embed")
    results["total"] += 1
    try:
        if embed_id:
            response = requests.delete(f"{BASE_URL}/admin/dashboard/embeds/{embed_id}", 
                headers={"Authorization": f"Bearer {admin_token}"})
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    # Verify it's gone
                    response = requests.get(f"{BASE_URL}/admin/dashboard/embeds", 
                        headers={"Authorization": f"Bearer {admin_token}"})
                    embeds = response.json().get("embeds", [])
                    deleted_embed = next((e for e in embeds if e.get("id") == embed_id), None)
                    if not deleted_embed:
                        print_test("DELETE embed", True, f"Embed {embed_id} successfully deleted and not in GET")
                        results["passed"] += 1
                    else:
                        print_test("DELETE embed", False, f"Embed {embed_id} still exists after DELETE")
                        results["failed"] += 1
                else:
                    print_test("DELETE embed", False, f"success=false: {data}")
                    results["failed"] += 1
            else:
                print_test("DELETE embed", False, f"HTTP {response.status_code}: {response.text}")
                results["failed"] += 1
        else:
            print_test("DELETE embed", False, "No embed_id available from previous test")
            results["failed"] += 1
    except Exception as e:
        print_test("DELETE embed", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 10-13: GUARDS - Non-admin user ==========
    print("TEST 10: GUARD - GET embeds with non-admin token (should return 403)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {normal_token}"})
        if response.status_code == 403:
            print_test("GUARD - GET embeds (non-admin)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - GET embeds (non-admin)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - GET embeds (non-admin)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 11: GUARD - POST embeds with non-admin token (should return 403)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {normal_token}"},
            json={"name": "test", "title": "test"})
        if response.status_code == 403:
            print_test("GUARD - POST embeds (non-admin)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - POST embeds (non-admin)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - POST embeds (non-admin)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 12: GUARD - GET bot-status with non-admin token (should return 403)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/bot-status", 
            headers={"Authorization": f"Bearer {normal_token}"})
        if response.status_code == 403:
            print_test("GUARD - GET bot-status (non-admin)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - GET bot-status (non-admin)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - GET bot-status (non-admin)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 13: GUARD - POST register-commands with non-admin token (should return 403)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/register-commands", 
            headers={"Authorization": f"Bearer {normal_token}"})
        if response.status_code == 403:
            print_test("GUARD - POST register-commands (non-admin)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - POST register-commands (non-admin)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - POST register-commands (non-admin)", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 14-17: GUARDS - No auth header ==========
    print("TEST 14: GUARD - GET embeds with no auth (should return 403)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/embeds")
        if response.status_code == 403:
            print_test("GUARD - GET embeds (no auth)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - GET embeds (no auth)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - GET embeds (no auth)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 15: GUARD - POST embeds with no auth (should return 403)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            json={"name": "test", "title": "test"})
        if response.status_code == 403:
            print_test("GUARD - POST embeds (no auth)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - POST embeds (no auth)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - POST embeds (no auth)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 16: GUARD - GET bot-status with no auth (should return 403)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/bot-status")
        if response.status_code == 403:
            print_test("GUARD - GET bot-status (no auth)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - GET bot-status (no auth)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - GET bot-status (no auth)", False, f"Exception: {e}")
        results["failed"] += 1
    
    print("TEST 17: GUARD - POST register-commands with no auth (should return 403)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/register-commands")
        if response.status_code == 403:
            print_test("GUARD - POST register-commands (no auth)", True, f"Correctly returned 403")
            results["passed"] += 1
        else:
            print_test("GUARD - POST register-commands (no auth)", False, f"Expected 403, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("GUARD - POST register-commands (no auth)", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 18: BOT STATUS (admin) ==========
    print("TEST 18: GET bot-status (admin)")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/admin/dashboard/bot-status", 
            headers={"Authorization": f"Bearer {admin_token}"})
        if response.status_code == 200:
            data = response.json()
            required_keys = ["tokenValid", "botUsername", "publicKeySet", "commandsRegistered", "commands", "ready"]
            missing_keys = [k for k in required_keys if k not in data]
            
            if not missing_keys:
                token_valid = data.get("tokenValid")
                bot_username = data.get("botUsername")
                public_key_set = data.get("publicKeySet")
                commands_registered = data.get("commandsRegistered")
                commands = data.get("commands", [])
                ready = data.get("ready")
                
                has_embed = "embed" in commands
                has_claim = "claim" in commands
                
                if token_valid and bot_username and public_key_set and commands_registered and has_embed and has_claim and ready:
                    print_test("GET bot-status", True, 
                        f"tokenValid={token_valid}, botUsername={bot_username}, publicKeySet={public_key_set}, "
                        f"commandsRegistered={commands_registered}, commands={commands}, ready={ready}")
                    results["passed"] += 1
                else:
                    print_test("GET bot-status", False, 
                        f"Some values not as expected: tokenValid={token_valid}, botUsername={bot_username}, "
                        f"publicKeySet={public_key_set}, commandsRegistered={commands_registered}, "
                        f"has_embed={has_embed}, has_claim={has_claim}, ready={ready}")
                    results["failed"] += 1
            else:
                print_test("GET bot-status", False, f"Missing keys: {missing_keys}")
                results["failed"] += 1
        else:
            print_test("GET bot-status", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("GET bot-status", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 19: REGISTER COMMANDS (admin) ==========
    print("TEST 19: POST register-commands (admin)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/register-commands", 
            headers={"Authorization": f"Bearer {admin_token}"})
        if response.status_code == 200:
            data = response.json()
            success = data.get("success")
            commands = data.get("commands", [])
            
            has_embed = "embed" in commands
            has_claim = "claim" in commands
            
            if success and has_embed and has_claim:
                print_test("POST register-commands", True, f"success={success}, commands={commands}")
                results["passed"] += 1
            else:
                print_test("POST register-commands", False, 
                    f"success={success}, has_embed={has_embed}, has_claim={has_claim}, commands={commands}")
                results["failed"] += 1
        else:
            print_test("POST register-commands", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("POST register-commands", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 20: POST-TO-CHANNEL - Create a new embed for posting ==========
    print("TEST 20: Create embed for post-to-channel test")
    results["total"] += 1
    post_embed_id = None
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "name": "test_post",
                "title": "Test Post to Channel",
                "description": "This is a test embed for posting to Discord channel",
                "color": "#3b82f6"
            })
        if response.status_code == 200:
            data = response.json()
            post_embed_id = data.get("embed", {}).get("id")
            if post_embed_id:
                print_test("Create embed for posting", True, f"Embed created with id={post_embed_id}")
                results["passed"] += 1
            else:
                print_test("Create embed for posting", False, f"No id in response: {data}")
                results["failed"] += 1
        else:
            print_test("Create embed for posting", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("Create embed for posting", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 21: POST-TO-CHANNEL - Post embed to Discord channel ==========
    print("TEST 21: POST embed to Discord channel")
    results["total"] += 1
    try:
        if post_embed_id:
            response = requests.post(f"{BASE_URL}/admin/dashboard/embeds/{post_embed_id}/post", 
                headers={"Authorization": f"Bearer {admin_token}"},
                json={})
            
            if response.status_code == 200:
                data = response.json()
                success = data.get("success")
                message_id = data.get("messageId")
                
                if success and message_id:
                    print_test("POST embed to channel", True, f"success={success}, messageId={message_id}")
                    results["passed"] += 1
                else:
                    print_test("POST embed to channel", False, f"success={success}, messageId={message_id}")
                    results["failed"] += 1
            else:
                print_test("POST embed to channel", False, f"HTTP {response.status_code}: {response.text}")
                results["failed"] += 1
        else:
            print_test("POST embed to channel", False, "No post_embed_id available")
            results["failed"] += 1
    except Exception as e:
        print_test("POST embed to channel", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 22: POST-TO-CHANNEL - Post nonexistent embed (should return 404) ==========
    print("TEST 22: POST nonexistent embed to channel (should return 404)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/admin/dashboard/embeds/nonexistent-id/post", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={})
        
        if response.status_code == 404:
            print_test("POST nonexistent embed", True, f"Correctly returned 404: {response.json()}")
            results["passed"] += 1
        else:
            print_test("POST nonexistent embed", False, f"Expected 404, got HTTP {response.status_code}")
            results["failed"] += 1
    except Exception as e:
        print_test("POST nonexistent embed", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 23: INTERACTIONS KEY CHECK - POST with no signature (should return 401) ==========
    print("TEST 23: POST /discord/interactions with no signature (should return 401)")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/discord/interactions", 
            json={"type": 1})
        
        if response.status_code == 401:
            print_test("INTERACTIONS key check", True, f"Correctly returned 401 (DISCORD_PUBLIC_KEY is configured)")
            results["passed"] += 1
        else:
            print_test("INTERACTIONS key check", False, 
                f"Expected 401, got HTTP {response.status_code}. Response: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("INTERACTIONS key check", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 24: REGRESSION - GET /config ==========
    print("TEST 24: REGRESSION - GET /config")
    results["total"] += 1
    try:
        response = requests.get(f"{BASE_URL}/config")
        if response.status_code == 200:
            data = response.json()
            crypto_configured = data.get("cryptoConfigured")
            provider = data.get("provider")
            
            if crypto_configured == True and provider == "blockbee":
                print_test("REGRESSION - GET /config", True, 
                    f"cryptoConfigured={crypto_configured}, provider={provider}")
                results["passed"] += 1
            else:
                print_test("REGRESSION - GET /config", False, 
                    f"cryptoConfigured={crypto_configured}, provider={provider}")
                results["failed"] += 1
        else:
            print_test("REGRESSION - GET /config", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("REGRESSION - GET /config", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== TEST 25: REGRESSION - Admin login returns isAdmin=true ==========
    print("TEST 25: REGRESSION - Admin login returns isAdmin=true")
    results["total"] += 1
    try:
        response = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            is_admin = data.get("user", {}).get("isAdmin")
            
            if is_admin == True:
                print_test("REGRESSION - Admin login isAdmin", True, f"isAdmin={is_admin}")
                results["passed"] += 1
            else:
                print_test("REGRESSION - Admin login isAdmin", False, f"isAdmin={is_admin}")
                results["failed"] += 1
        else:
            print_test("REGRESSION - Admin login isAdmin", False, f"HTTP {response.status_code}: {response.text}")
            results["failed"] += 1
    except Exception as e:
        print_test("REGRESSION - Admin login isAdmin", False, f"Exception: {e}")
        results["failed"] += 1
    
    # ========== SUMMARY ==========
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {results['total']}")
    print(f"Passed: {results['passed']}")
    print(f"Failed: {results['failed']}")
    print(f"Success rate: {(results['passed']/results['total']*100):.1f}%")
    print("=" * 80)
    
    return results

if __name__ == "__main__":
    results = main()
    sys.exit(0 if results["failed"] == 0 else 1)

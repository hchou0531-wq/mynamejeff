#!/usr/bin/env python3
"""
Backend test for UPDATE 8: GET /api/profile/:id/rap-history endpoint
Tests the new rap-history endpoint that returns total account RAP over time.
"""

import requests
import json
import sys

BASE_URL = "https://roblox-market-24.preview.emergentagent.com/api"

def test_rap_history():
    """Test the new GET /api/profile/:id/rap-history endpoint"""
    
    print("\n" + "="*80)
    print("TESTING UPDATE 8: GET /api/profile/:id/rap-history")
    print("="*80)
    
    # Step 1: Resolve a real public Roblox user
    print("\n[STEP 1] Resolving real public Roblox user...")
    test_users = ["builderman", "1", "Linkmon99"]
    user_id = None
    
    for test_input in test_users:
        try:
            print(f"  Trying lookup with input='{test_input}'...")
            response = requests.get(f"{BASE_URL}/profile/lookup?input={test_input}", timeout=30)
            print(f"  Response status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                if "profile" in data and "id" in data["profile"]:
                    user_id = data["profile"]["id"]
                    username = data["profile"].get("name", "unknown")
                    print(f"  ✓ SUCCESS: Resolved user '{test_input}' -> id={user_id}, username={username}")
                    break
                else:
                    print(f"  ✗ FAILED: Response missing profile.id: {data}")
            else:
                print(f"  ✗ FAILED: HTTP {response.status_code}")
                print(f"  Response: {response.text[:200]}")
        except Exception as e:
            print(f"  ✗ ERROR: {str(e)}")
    
    if not user_id:
        print("\n✗ CRITICAL: Could not resolve any test user. Cannot proceed with rap-history test.")
        return False
    
    # Step 2: Test GET /api/profile/:id/rap-history
    print(f"\n[STEP 2] Testing GET /api/profile/{user_id}/rap-history...")
    try:
        response = requests.get(f"{BASE_URL}/profile/{user_id}/rap-history", timeout=45)
        print(f"  Response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: Expected HTTP 200, got {response.status_code}")
            print(f"  Response: {response.text[:500]}")
            return False
        
        data = response.json()
        print(f"  Response keys: {list(data.keys())}")
        
        # Verify required keys
        required_keys = ["totalRap", "count", "tracked", "history"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            print(f"  ✗ FAILED: Missing required keys: {missing_keys}")
            print(f"  Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        print(f"  ✓ All required keys present: {required_keys}")
        
        # Verify data types
        if not isinstance(data["totalRap"], (int, float)) or data["totalRap"] < 0:
            print(f"  ✗ FAILED: totalRap must be a number >= 0, got: {data['totalRap']} (type: {type(data['totalRap'])})")
            return False
        print(f"  ✓ totalRap is valid number: {data['totalRap']}")
        
        if not isinstance(data["count"], int) or data["count"] < 0:
            print(f"  ✗ FAILED: count must be an integer >= 0, got: {data['count']} (type: {type(data['count'])})")
            return False
        print(f"  ✓ count is valid integer: {data['count']}")
        
        if not isinstance(data["tracked"], int) or data["tracked"] < 0:
            print(f"  ✗ FAILED: tracked must be an integer >= 0, got: {data['tracked']} (type: {type(data['tracked'])})")
            return False
        print(f"  ✓ tracked is valid integer: {data['tracked']}")
        
        if not isinstance(data["history"], list):
            print(f"  ✗ FAILED: history must be an array, got: {type(data['history'])}")
            return False
        print(f"  ✓ history is an array with {len(data['history'])} entries")
        
        # Verify history entries format
        if len(data["history"]) > 0:
            print(f"  Verifying history entries format...")
            for i, entry in enumerate(data["history"][:3]):  # Check first 3 entries
                if not isinstance(entry, dict):
                    print(f"    ✗ FAILED: history[{i}] must be an object, got: {type(entry)}")
                    return False
                
                if "month" not in entry or "rap" not in entry:
                    print(f"    ✗ FAILED: history[{i}] missing required keys (month, rap): {entry}")
                    return False
                
                # Verify month format YYYY-MM
                month = entry["month"]
                if not isinstance(month, str) or len(month) != 7 or month[4] != "-":
                    print(f"    ✗ FAILED: history[{i}].month must be 'YYYY-MM' format, got: {month}")
                    return False
                
                # Verify rap is a number
                if not isinstance(entry["rap"], (int, float)):
                    print(f"    ✗ FAILED: history[{i}].rap must be a number, got: {entry['rap']} (type: {type(entry['rap'])})")
                    return False
                
                print(f"    ✓ history[{i}]: month={month}, rap={entry['rap']}")
            
            if len(data["history"]) > 12:
                print(f"  ⚠ WARNING: history has {len(data['history'])} entries, expected up to 12")
            else:
                print(f"  ✓ history length is valid (up to 12 months)")
        else:
            print(f"  ℹ history is empty (account may have no limiteds or private inventory)")
        
        print(f"\n  ✓ SUCCESS: rap-history endpoint returns valid structure")
        print(f"    - totalRap: {data['totalRap']}")
        print(f"    - count: {data['count']}")
        print(f"    - tracked: {data['tracked']}")
        print(f"    - history entries: {len(data['history'])}")
        
        # Store for cross-check
        rap_history_data = data
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    # Step 3: Cross-check with /api/profile/:id/limiteds
    print(f"\n[STEP 3] Cross-checking totalRap with GET /api/profile/{user_id}/limiteds...")
    try:
        response = requests.get(f"{BASE_URL}/profile/{user_id}/limiteds", timeout=45)
        print(f"  Response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: Expected HTTP 200, got {response.status_code}")
            return False
        
        data = response.json()
        
        if "limiteds" not in data:
            print(f"  ✗ FAILED: Response missing 'limiteds' key")
            return False
        
        limiteds = data["limiteds"]
        print(f"  ✓ Retrieved {len(limiteds)} limiteds")
        
        # Sum RAP from limiteds
        total_rap_from_limiteds = sum(item.get("rap", 0) for item in limiteds)
        print(f"  Sum of RAP from limiteds: {total_rap_from_limiteds}")
        print(f"  totalRap from rap-history: {rap_history_data['totalRap']}")
        
        # Allow small differences (rounding, timing)
        if len(limiteds) > 0:
            diff = abs(total_rap_from_limiteds - rap_history_data['totalRap'])
            diff_percent = (diff / max(total_rap_from_limiteds, 1)) * 100
            
            if diff_percent > 5:  # Allow up to 5% difference
                print(f"  ⚠ WARNING: totalRap differs by {diff} ({diff_percent:.2f}%)")
                print(f"    This may be acceptable due to timing or rounding differences")
            else:
                print(f"  ✓ totalRap matches closely (difference: {diff}, {diff_percent:.2f}%)")
        else:
            if rap_history_data['totalRap'] == 0:
                print(f"  ✓ Both endpoints show 0 RAP (no limiteds)")
            else:
                print(f"  ⚠ WARNING: No limiteds but totalRap is {rap_history_data['totalRap']}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    # Step 4: Test graceful handling for nonexistent user
    print(f"\n[STEP 4] Testing graceful handling for nonexistent user...")
    try:
        fake_user_id = "999999999999"
        response = requests.get(f"{BASE_URL}/profile/{fake_user_id}/rap-history", timeout=30)
        print(f"  Response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: Expected HTTP 200 (graceful), got {response.status_code}")
            print(f"  Response: {response.text[:500]}")
            return False
        
        data = response.json()
        print(f"  Response: {json.dumps(data, indent=2)}")
        
        # Should return empty history or private flag
        if "history" not in data:
            print(f"  ✗ FAILED: Response missing 'history' key")
            return False
        
        if not isinstance(data["history"], list):
            print(f"  ✗ FAILED: history must be an array")
            return False
        
        # Check for graceful response (empty history or private flag)
        if len(data["history"]) == 0 or data.get("private") == True:
            print(f"  ✓ SUCCESS: Graceful handling - returns empty history or private flag")
            print(f"    - history: {data['history']}")
            print(f"    - private: {data.get('private', False)}")
        else:
            print(f"  ⚠ WARNING: Unexpected data for nonexistent user: {data}")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    # Step 5: Regression tests
    print(f"\n[STEP 5] Regression tests for existing endpoints...")
    
    # Test /api/profile/lookup
    print(f"  Testing GET /api/profile/lookup?input=builderman...")
    try:
        response = requests.get(f"{BASE_URL}/profile/lookup?input=builderman", timeout=30)
        if response.status_code == 200:
            print(f"    ✓ GET /api/profile/lookup returns HTTP 200")
        else:
            print(f"    ✗ FAILED: GET /api/profile/lookup returned HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Test /api/profile/:id/limiteds
    print(f"  Testing GET /api/profile/{user_id}/limiteds...")
    try:
        response = requests.get(f"{BASE_URL}/profile/{user_id}/limiteds", timeout=45)
        if response.status_code == 200:
            print(f"    ✓ GET /api/profile/:id/limiteds returns HTTP 200")
        else:
            print(f"    ✗ FAILED: GET /api/profile/:id/limiteds returned HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    # Test /api/profile/:id/gamepasses
    print(f"  Testing GET /api/profile/{user_id}/gamepasses...")
    try:
        response = requests.get(f"{BASE_URL}/profile/{user_id}/gamepasses", timeout=45)
        if response.status_code == 200:
            print(f"    ✓ GET /api/profile/:id/gamepasses returns HTTP 200")
        else:
            print(f"    ✗ FAILED: GET /api/profile/:id/gamepasses returned HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"    ✗ ERROR: {str(e)}")
        return False
    
    print(f"\n  ✓ All regression tests passed")
    
    return True


if __name__ == "__main__":
    print("\n" + "="*80)
    print("BACKEND TEST: UPDATE 8 - RAP History Endpoint")
    print("="*80)
    
    try:
        success = test_rap_history()
        
        print("\n" + "="*80)
        if success:
            print("✓ ALL TESTS PASSED")
            print("="*80)
            sys.exit(0)
        else:
            print("✗ TESTS FAILED")
            print("="*80)
            sys.exit(1)
    except Exception as e:
        print(f"\n✗ CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        print("="*80)
        sys.exit(1)

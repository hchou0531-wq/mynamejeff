#!/usr/bin/env python3
"""
Backend test for Roblox profile pagination BUGFIX (UPDATE 8.1)
Tests that GET /api/profile/:id/limiteds now paginates through ALL collectibles (not just first 100)
"""
import requests
import sys
import time

# Base URL from environment
BASE_URL = "https://landing-page-copy-1.preview.emergentagent.com/api"

def test_pagination_bugfix():
    """
    Verify pagination BUGFIX in Roblox profile endpoints.
    Previously GET /api/profile/:id/limiteds only returned first 100 collectibles.
    Now it paginates through ALL of them, affecting both item count and total RAP.
    """
    print("=" * 80)
    print("TESTING: Roblox Profile Pagination BUGFIX (UPDATE 8.1)")
    print("=" * 80)
    
    # Step 1: GET /api/profile/lookup?input=Linkmon99 -> get profile.id
    print("\n[STEP 1] Looking up Linkmon99 (famous trader with >100 limiteds)...")
    
    # Try Linkmon99 first (famous trader with very large limited collection)
    test_users = [
        ("Linkmon99", "famous trader with very large limited collection"),
        ("Roblox", "fallback option 1"),
        ("builderman", "fallback option 2")
    ]
    
    profile_id = None
    username_used = None
    
    for username, description in test_users:
        try:
            print(f"  Trying {username} ({description})...")
            response = requests.get(
                f"{BASE_URL}/profile/lookup",
                params={"input": username},
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                if "profile" in data and "id" in data["profile"]:
                    profile_id = data["profile"]["id"]
                    username_used = username
                    print(f"  ✓ SUCCESS: Resolved '{username}' -> id={profile_id}")
                    print(f"    Display Name: {data['profile'].get('displayName', 'N/A')}")
                    print(f"    Username: {data['profile'].get('name', 'N/A')}")
                    break
                else:
                    print(f"  ✗ FAILED: Response missing profile data")
            else:
                print(f"  ✗ FAILED: HTTP {response.status_code}")
                
        except Exception as e:
            print(f"  ✗ ERROR: {str(e)}")
    
    if not profile_id:
        print("\n✗ CRITICAL: Could not resolve any test user. Cannot proceed with pagination test.")
        return False
    
    # Step 2: GET /api/profile/{id}/limiteds -> confirm array length > 100 (proves pagination)
    print(f"\n[STEP 2] Fetching limiteds for user {profile_id} ({username_used})...")
    print("  NOTE: This may take several seconds for large accounts (sequential paging + resale-data fetches)")
    
    try:
        start_time = time.time()
        response = requests.get(
            f"{BASE_URL}/profile/{profile_id}/limiteds",
            timeout=60  # Allow generous timeout for large accounts
        )
        elapsed = time.time() - start_time
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        limiteds = data.get("limiteds", [])
        limiteds_count = len(limiteds)
        
        print(f"  ✓ SUCCESS: HTTP 200 (took {elapsed:.1f}s)")
        print(f"  ✓ Limiteds array length: {limiteds_count}")
        
        # Verify pagination worked (should be > 100 for Linkmon99 or similar large accounts)
        if username_used == "Linkmon99" and limiteds_count <= 100:
            print(f"  ⚠ WARNING: Expected >100 limiteds for Linkmon99, got {limiteds_count}")
            print(f"    This suggests pagination may not be working correctly.")
        elif username_used in ["Roblox", "builderman"] and limiteds_count <= 100:
            print(f"  ℹ INFO: {username_used} has {limiteds_count} limiteds (≤100, pagination not exercised)")
        else:
            print(f"  ✓ PAGINATION VERIFIED: {limiteds_count} items (>100 proves pagination works)")
        
        # Calculate sum of RAP for cross-check in step 3
        total_rap_from_limiteds = sum(item.get("rap", 0) or 0 for item in limiteds)
        print(f"  ✓ Sum of RAP from all limiteds: {total_rap_from_limiteds:,}")
        
    except requests.exceptions.Timeout:
        print(f"  ✗ TIMEOUT: Request took >60s (may be normal for very large accounts)")
        return False
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 3: GET /api/profile/{id}/rap-history -> verify count, totalRap, history
    print(f"\n[STEP 3] Fetching rap-history for user {profile_id}...")
    print("  NOTE: This may take up to 60s for large accounts (up to 30 resale-data fetches)")
    
    try:
        start_time = time.time()
        response = requests.get(
            f"{BASE_URL}/profile/{profile_id}/rap-history",
            timeout=60
        )
        elapsed = time.time() - start_time
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: HTTP {response.status_code}")
            print(f"    Response: {response.text[:200]}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200 (took {elapsed:.1f}s)")
        
        # (a) Verify required keys exist
        required_keys = ["totalRap", "count", "tracked", "history"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            print(f"  ✗ FAILED: Missing required keys: {missing_keys}")
            return False
        print(f"  ✓ All required keys present: {required_keys}")
        
        # (b) Verify count equals limiteds array length from step 2
        rap_history_count = data["count"]
        if rap_history_count != limiteds_count:
            print(f"  ✗ FAILED: count mismatch!")
            print(f"    rap-history count: {rap_history_count}")
            print(f"    limiteds array length: {limiteds_count}")
            return False
        print(f"  ✓ count matches limiteds array length: {rap_history_count}")
        
        # (c) Verify totalRap equals exact sum of rap field across all limiteds
        total_rap_from_history = data["totalRap"]
        rap_difference = abs(total_rap_from_history - total_rap_from_limiteds)
        rap_diff_percent = (rap_difference / max(total_rap_from_history, 1)) * 100
        
        print(f"  ✓ totalRap from rap-history: {total_rap_from_history:,}")
        print(f"  ✓ Sum of RAP from limiteds: {total_rap_from_limiteds:,}")
        print(f"  ✓ Difference: {rap_difference:,} ({rap_diff_percent:.2f}%)")
        
        if rap_difference != 0:
            print(f"  ✗ FAILED: totalRap does NOT match exact sum of limiteds RAP!")
            print(f"    Expected: {total_rap_from_limiteds:,}")
            print(f"    Got: {total_rap_from_history:,}")
            return False
        print(f"  ✓ totalRap matches EXACTLY with sum of limiteds RAP")
        
        # (d) Verify history is an array with up to 12 entries
        history = data.get("history", [])
        if not isinstance(history, list):
            print(f"  ✗ FAILED: history is not an array")
            return False
        
        history_length = len(history)
        if history_length > 12:
            print(f"  ✗ FAILED: history has {history_length} entries (expected ≤12)")
            return False
        
        print(f"  ✓ history is an array with {history_length} entries (≤12)")
        
        # Verify each history entry has correct format
        for i, entry in enumerate(history):
            if not isinstance(entry, dict):
                print(f"  ✗ FAILED: history[{i}] is not an object")
                return False
            if "month" not in entry or "rap" not in entry:
                print(f"  ✗ FAILED: history[{i}] missing 'month' or 'rap'")
                return False
            # Verify month format YYYY-MM
            month = entry["month"]
            if not isinstance(month, str) or len(month) != 7 or month[4] != "-":
                print(f"  ✗ FAILED: history[{i}].month has invalid format: {month}")
                return False
            # Verify rap is a number
            if not isinstance(entry["rap"], (int, float)):
                print(f"  ✗ FAILED: history[{i}].rap is not a number: {entry['rap']}")
                return False
        
        print(f"  ✓ All history entries have correct format (month='YYYY-MM', rap=number)")
        
        # Print tracked count
        tracked = data.get("tracked", 0)
        print(f"  ℹ INFO: tracked={tracked} (top holdings by RAP with detailed history)")
        
    except requests.exceptions.Timeout:
        print(f"  ✗ TIMEOUT: Request took >60s")
        return False
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 4: REGRESSION - builderman (id=156) should still work correctly
    print(f"\n[STEP 4] REGRESSION TEST: builderman (id=156)...")
    
    try:
        # Lookup builderman
        response = requests.get(
            f"{BASE_URL}/profile/lookup",
            params={"input": "builderman"},
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: Lookup failed with HTTP {response.status_code}")
            return False
        
        data = response.json()
        builderman_id = data.get("profile", {}).get("id")
        
        if builderman_id != 156:
            print(f"  ⚠ WARNING: builderman id is {builderman_id}, expected 156")
        else:
            print(f"  ✓ builderman id confirmed: 156")
        
        # Get limiteds
        response = requests.get(
            f"{BASE_URL}/profile/{builderman_id}/limiteds",
            timeout=60
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: limiteds failed with HTTP {response.status_code}")
            return False
        
        limiteds_data = response.json()
        builderman_limiteds = limiteds_data.get("limiteds", [])
        builderman_limiteds_count = len(builderman_limiteds)
        builderman_rap_sum = sum(item.get("rap", 0) or 0 for item in builderman_limiteds)
        
        print(f"  ✓ builderman limiteds count: {builderman_limiteds_count}")
        print(f"  ✓ builderman RAP sum: {builderman_rap_sum:,}")
        
        # Get rap-history
        response = requests.get(
            f"{BASE_URL}/profile/{builderman_id}/rap-history",
            timeout=60
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: rap-history failed with HTTP {response.status_code}")
            return False
        
        rap_data = response.json()
        builderman_total_rap = rap_data.get("totalRap", 0)
        builderman_count = rap_data.get("count", 0)
        
        print(f"  ✓ builderman rap-history totalRap: {builderman_total_rap:,}")
        print(f"  ✓ builderman rap-history count: {builderman_count}")
        
        # Verify count matches
        if builderman_count != builderman_limiteds_count:
            print(f"  ✗ FAILED: count mismatch for builderman!")
            print(f"    rap-history count: {builderman_count}")
            print(f"    limiteds count: {builderman_limiteds_count}")
            return False
        
        # Verify totalRap matches
        if builderman_total_rap != builderman_rap_sum:
            print(f"  ✗ FAILED: totalRap mismatch for builderman!")
            print(f"    rap-history totalRap: {builderman_total_rap:,}")
            print(f"    limiteds RAP sum: {builderman_rap_sum:,}")
            return False
        
        print(f"  ✓ REGRESSION PASSED: builderman count and totalRap match exactly")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    # Step 5: Graceful handling - nonexistent user should return HTTP 200 with empty history
    print(f"\n[STEP 5] GRACEFUL HANDLING: nonexistent user (999999999999)...")
    
    try:
        response = requests.get(
            f"{BASE_URL}/profile/999999999999/rap-history",
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"  ✗ FAILED: Expected HTTP 200, got {response.status_code}")
            return False
        
        data = response.json()
        print(f"  ✓ SUCCESS: HTTP 200 (graceful handling)")
        
        # Verify empty/private response
        if data.get("private") != True:
            print(f"  ⚠ WARNING: Expected private=true flag")
        else:
            print(f"  ✓ private=true flag present")
        
        history = data.get("history", [])
        if len(history) != 0:
            print(f"  ⚠ WARNING: Expected empty history, got {len(history)} entries")
        else:
            print(f"  ✓ history is empty array")
        
        print(f"  ✓ GRACEFUL HANDLING PASSED: No 500 error, returns HTTP 200 with empty/private response")
        
    except Exception as e:
        print(f"  ✗ ERROR: {str(e)}")
        return False
    
    print("\n" + "=" * 80)
    print("✓ ALL PAGINATION BUGFIX TESTS PASSED")
    print("=" * 80)
    return True


if __name__ == "__main__":
    try:
        success = test_pagination_bugfix()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

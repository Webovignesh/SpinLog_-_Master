# Bugfix Requirements Document

## Introduction

This bugfix addresses six issues in the SpinLog PWA affecting mobile usability and the notification system:
1. Mobile scroll is blocked for 2-3 seconds due to `touch-action: none` on home cards
2. Long-press popups fail on the last-park and cover cards due to overly sensitive `pointermove` cancellation
3. Anniversary notification uses wrong purchase date (`2024-06-27` instead of `2025-06-27`)
4. Milestone notifications (1k, 5k, 10k) should be completely removed
5. First-connect notification should be completely removed
6. Notifications only fire when the app is open — they should trigger in the background via the service worker

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user touches `.home-park-card` or `.home-cover-card` on mobile THEN the system blocks all page scrolling for the duration of contact because `touch-action: none` prevents the browser's native scroll handling

1.2 WHEN the user performs a long-press on `.home-park-card` or `.home-cover-card` on mobile and their finger moves even slightly (natural touch drift) THEN the system cancels the long-press timer via the `pointermove` listener, preventing the popup from appearing

1.3 WHEN the `makeLongPressCard` function handles a short tap (pointerup without long-press firing) THEN the system provides no feedback or tap action because it only calls `cancel()` with no `onTap` callback

1.4 WHEN the app calls `checkAnniversaryNotif('2024-06-27')` THEN the system checks month=6, day=27 against an incorrect purchase year of 2024 (actual purchase date is 27-06-2025, meaning the year parameter is wrong)

1.5 WHEN the user's odometer reaches 1000, 5000, or 10000 km THEN the system fires milestone notifications that the user does not want

1.6 WHEN the user grants notification permission for the first time THEN the system fires a `SAGE_FIRST_CONNECT` notification that the user does not want

1.7 WHEN the app is not open (closed or in background) THEN the system never checks or fires any scheduled notifications (insurance expiry, EMI due, anniversary, service due) because all notification logic runs only in the main thread on app startup

### Expected Behavior (Correct)

2.1 WHEN the user touches `.home-park-card` or `.home-cover-card` on mobile THEN the system SHALL allow normal vertical scrolling while still supporting long-press gesture detection (using `touch-action: pan-y` instead of `touch-action: none`)

2.2 WHEN the user performs a long-press on mobile and their finger moves less than a small threshold (~10px) THEN the system SHALL NOT cancel the long-press timer, tolerating minor touch drift

2.3 WHEN the `makeLongPressCard` function handles a short tap THEN the system SHALL provide visual feedback or remain a no-op without breaking the UX (no crash, no stale timer)

2.4 WHEN the app calls `checkAnniversaryNotif` THEN the system SHALL use the correct purchase date `'2025-06-27'` so the anniversary fires on June 27 each year starting from 2025

2.5 WHEN the user's odometer reaches any km value THEN the system SHALL NOT fire milestone notifications (the `checkMilestoneNotif` function, its calls, and the `milestone1k`/`milestone5k`/`milestone10k` message arrays SHALL be removed)

2.6 WHEN the user grants notification permission THEN the system SHALL NOT fire a first-connect notification (the `SAGE_FIRST_CONNECT` array, `sendSageFirstConnectNotif` function, its window export, and the call in index.html SHALL be removed)

2.7 WHEN the app is not open THEN the service worker SHALL periodically check notification conditions (insurance expiry, EMI due, anniversary, service due) using the Periodic Background Sync API where supported, falling back to checking on service worker activation events

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user performs a valid long-press (holds finger steady for 650ms) on `.home-park-card` THEN the system SHALL CONTINUE TO show the park history popup

3.2 WHEN the user performs a valid long-press on `.home-cover-card` THEN the system SHALL CONTINUE TO open the cover date editing modal

3.3 WHEN the user short-taps `.home-park-card` THEN the system SHALL CONTINUE TO save the current park location

3.4 WHEN the app is open and data loads THEN the system SHALL CONTINUE TO check and fire service-due, insurance, EMI, document-expiry, re-engagement, anniversary, record-saved, and parking notifications as before

3.5 WHEN the user scrolls on areas outside the park/cover cards THEN the system SHALL CONTINUE TO scroll normally without any delay

3.6 WHEN the service worker handles push events from a server THEN the system SHALL CONTINUE TO show push notifications as before

3.7 WHEN the user interacts with notification click events THEN the system SHALL CONTINUE TO focus or open the app window as before

---

## Bug Condition Derivation

### Bug 1 & 2: Touch/Scroll/Long-Press

```pascal
FUNCTION isBugCondition_Touch(X)
  INPUT: X of type TouchInteraction { element, gesture, fingerDrift }
  OUTPUT: boolean

  // Bug triggers when user touches a park/cover card and tries to scroll or long-press with natural drift
  RETURN X.element IN {'.home-park-card', '.home-cover-card'}
    AND (X.gesture = 'scroll' OR (X.gesture = 'longpress' AND X.fingerDrift > 0))
END FUNCTION
```

```pascal
// Property: Fix Checking — Scroll and Long-Press
FOR ALL X WHERE isBugCondition_Touch(X) DO
  IF X.gesture = 'scroll' THEN
    ASSERT page_scrolls_vertically(X)
  ELSE IF X.gesture = 'longpress' AND X.fingerDrift < 10px THEN
    ASSERT longpress_fires(X)
  END IF
END FOR
```

```pascal
// Property: Preservation Checking — Touch interactions
FOR ALL X WHERE NOT isBugCondition_Touch(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

### Bug 3: Anniversary Date

```pascal
FUNCTION isBugCondition_Anniversary(X)
  INPUT: X of type AnniversaryCall { dateString }
  OUTPUT: boolean

  RETURN X.dateString = '2024-06-27'  // Wrong year passed
END FUNCTION
```

```pascal
// Property: Fix Checking — Anniversary
FOR ALL X WHERE isBugCondition_Anniversary(X) DO
  result ← checkAnniversaryNotif'('2025-06-27')
  ASSERT result.checksMonth = 6 AND result.checksDay = 27 AND result.purchaseYear = 2025
END FOR
```

### Bug 4 & 5: Feature Removal (Milestone & First-Connect)

```pascal
FUNCTION isBugCondition_Removal(X)
  INPUT: X of type NotifTrigger { type }
  OUTPUT: boolean

  RETURN X.type IN {'milestone', 'firstConnect'}
END FUNCTION
```

```pascal
// Property: Fix Checking — Removal
FOR ALL X WHERE isBugCondition_Removal(X) DO
  ASSERT notification_not_sent(X)  // These notification paths no longer exist
END FOR
```

### Bug 6: Background Notifications

```pascal
FUNCTION isBugCondition_Background(X)
  INPUT: X of type AppState { isOpen, hasScheduledNotif }
  OUTPUT: boolean

  RETURN NOT X.isOpen AND X.hasScheduledNotif = true
END FUNCTION
```

```pascal
// Property: Fix Checking — Background Notifications
FOR ALL X WHERE isBugCondition_Background(X) DO
  result ← serviceWorker'.periodicSync(X)
  ASSERT notification_conditions_checked(result)
END FOR
```

```pascal
// Property: Preservation Checking — Background Notifications
FOR ALL X WHERE NOT isBugCondition_Background(X) DO
  ASSERT F(X) = F'(X)  // When app IS open, existing notification logic continues as before
END FOR
```

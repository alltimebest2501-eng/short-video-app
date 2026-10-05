# ShortWave — Short Video App Starter

This is the first UI/architecture starter for the requested short-video app.

Included:
- No login screen
- Vertical short-video feed
- Discover/categories
- Creator profile
- Creator analytics/earnings concept
- Viewer Premium: ₹119
- Creator Pro: ₹499/year
- Settings
- Ads/DiskWala sync placeholders in the architecture

## Important
This is a UI starter, not the finished production app.

The DiskWala automatic-sync backend is intentionally not implemented yet because its authorized account/library API has not been verified. The final backend should use an authorized integration rather than bypassing DiskWala security.

## Run
Install Flutter, then:

flutter pub get
flutter run

Next production work:
1. Backend + database
2. Authorized DiskWala sync
3. Real HLS/video player
4. Google Play Billing
5. AdMob
6. Creator payout/anti-fraud rules
7. Admin panel
8. Analytics and moderation

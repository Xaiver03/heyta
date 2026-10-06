#import <React/RCTBridgeModule.h>

/**
 * Swift cannot call RCT_EXPORT_MODULE itself. Keep this declaration-only
 * bridge in lockstep with HeytaVaultSecureStorage.swift; all storage logic is
 * in Swift so it remains reviewable without duplicating it in Objective-C.
 */
@interface RCT_EXTERN_MODULE(HeytaVaultSecureStorage, NSObject)

RCT_EXTERN_METHOD(load:(NSString *)serverOrigin
                  accountId:(NSString *)accountId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(save:(NSString *)serverOrigin
                  accountId:(NSString *)accountId
                  rootKeyBase64:(NSString *)rootKeyBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(remove:(NSString *)serverOrigin
                  accountId:(NSString *)accountId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

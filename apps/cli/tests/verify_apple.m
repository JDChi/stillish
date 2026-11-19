#import <AppKit/AppKit.h>
#import <Photos/Photos.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 64;
        NSArray<NSURL *> *files = @[
            [NSURL fileURLWithPath:@(argv[1])],
            [NSURL fileURLWithPath:@(argv[2])],
        ];
        __block int status = 2;
        __block BOOL completed = NO;
        [PHLivePhoto requestLivePhotoWithResourceFileURLs:files placeholderImage:nil
            targetSize:CGSizeZero contentMode:PHImageContentModeDefault
            resultHandler:^(PHLivePhoto *photo, NSDictionary *info) {
                if ([info[PHLivePhotoInfoIsDegradedKey] boolValue]) return;
                if (photo) {
                    NSArray<PHAssetResource *> *resources = [PHAssetResource assetResourcesForLivePhoto:photo];
                    BOOL hasVideo = NO;
                    for (PHAssetResource *resource in resources) {
                        if (resource.type == PHAssetResourceTypePairedVideo) hasVideo = YES;
                    }
                    if (hasVideo) status = 0;
                    printf("PhotoKit: %lu resources, pairedVideo=%s\n",
                        (unsigned long)resources.count, hasVideo ? "yes" : "no");
                } else {
                    fprintf(stderr, "PhotoKit could not load: %s\n", [info.description UTF8String]);
                }
                completed = YES;
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
        while (!completed && [deadline timeIntervalSinceNow] > 0) {
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        }
        if (!completed) fprintf(stderr, "PhotoKit request timed out\n");
        return status;
    }
}

// Loads the packaged plug-in through its principal class, as the Dock does.
#import <AppKit/AppKit.h>
#import <assert.h>
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        assert(argc == 3);
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        NSBundle *bundle = [NSBundle bundleWithPath:[NSString stringWithUTF8String:argv[1]]];
        NSError *error = nil;
        if (![bundle loadAndReturnError:&error]) { NSLog(@"%@", error); return 1; }
        id<NSDockTilePlugIn> plugin = [[bundle.principalClass alloc] init];
        assert([plugin conformsToProtocol:@protocol(NSDockTilePlugIn)]);
        NSDockTile *tile = NSApp.dockTile;
        [plugin setDockTile:tile];
        assert([tile.contentView isKindOfClass:NSImageView.class]);
        NSImageView *view = (NSImageView *)tile.contentView;
        assert(view.image != nil);
        view.frame = NSMakeRect(0, 0, 512, 512);
        NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
        assert([[rep colorAtX:0 y:0] alphaComponent] == 0);
        assert([[rep colorAtX:rep.pixelsWide / 2 y:rep.pixelsHigh * 2 / 5] alphaComponent] > 0.99);
        NSData *data = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        assert([data writeToFile:[NSString stringWithUTF8String:argv[2]] atomically:YES]);
        [plugin setDockTile:nil];
        assert(tile.contentView == nil);
        [plugin setDockTile:tile];
        assert(tile.contentView != nil);
        [plugin setDockTile:nil];
        puts("Dock plug-in: loaded, transparent render, detach and reattach passed.");
    }
    return 0;
}

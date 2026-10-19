#import <AppKit/AppKit.h>

// The Dock hosts this small bundle while Fabi is not running. No polling,
// observers, subprocesses or network: render once when the system supplies a tile.
@interface FabiDockTile : NSObject <NSDockTilePlugIn>
@property(nonatomic, weak) NSDockTile *tile;
@end

@implementation FabiDockTile
- (void)setDockTile:(NSDockTile *)dockTile {
    if (self.tile && self.tile != dockTile) {
        self.tile.contentView = nil;
    }
    self.tile = dockTile;
    if (!dockTile) { return; }
    NSBundle *bundle = [NSBundle bundleForClass:self.class];
    NSString *path = [bundle pathForResource:@"fox" ofType:@"png"];
    NSImage *image = path ? [[NSImage alloc] initWithContentsOfFile:path] : nil;
    if (!image) { return; } // Preserve the system fallback if packaging is damaged.
    NSImageView *view = [[NSImageView alloc] initWithFrame:NSMakeRect(0, 0, dockTile.size.width, dockTile.size.height)];
    view.image = image;
    view.imageScaling = NSImageScaleProportionallyUpOrDown;
    view.imageAlignment = NSImageAlignCenter;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    dockTile.contentView = view;
    [dockTile display];
}
@end

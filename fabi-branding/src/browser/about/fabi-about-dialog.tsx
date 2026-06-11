import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { foxSvgMarkup } from '../../common/fox';

/**
 * Dialog "À propos" rebrandé Fabi : on ne réécrit que l'en-tête (le renard +
 * le wordmark + la version), tout le reste (liste des extensions, liens) reste
 * géré par la classe du core — on étend, on ne casse pas.
 */
@injectable()
export class FabiAboutDialog extends AboutDialog {

    protected renderHeader(): React.ReactNode {
        const appInfo = this.applicationInfo;
        return (
            <div className='fabi-about-header'>
                <div className='fabi-about-logo' dangerouslySetInnerHTML={{ __html: foxSvgMarkup() }} />
                <div className='fabi-about-titles'>
                    <h1 className='fabi-wordmark'><span className='fa'>Fa</span><span className='bi'>bi</span></h1>
                    <p className='fabi-about-tagline'>IDE IA modulaire · basé sur Eclipse Theia</p>
                    {appInfo && <p className='fabi-about-version'>Version {appInfo.version}</p>}
                </div>
            </div>
        );
    }
}

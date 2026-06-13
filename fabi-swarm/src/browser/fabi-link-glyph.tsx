import * as React from '@theia/core/shared/react';
import { Laptop, Server, ChevronRight, LoaderCircle, Unplug } from 'lucide-react';

/**
 * Micro-illustration minimaliste : ta machine (Laptop) ↔ le swarm (Server), avec
 * un milieu animé selon l'état. Icônes Lucide (line, soignées). Sobre : couleurs
 * de thème, aucun orange, aucun halo. Réutilisé accueil + vue connexion.
 *   • flow       → chevrons qui défilent (données qui circulent)
 *   • connecting → spinner (loader)
 *   • waiting    → trois points qui clignotent (attente de pairs)
 *   • error      → prise débranchée, atténué
 */

export type FabiLinkState = 'flow' | 'connecting' | 'waiting' | 'error';

export const FabiLinkGlyph: React.FC<{ state?: FabiLinkState; size?: 'sm' | 'md' }> =
    ({ state = 'flow', size = 'sm' }) => {
        const pc = size === 'md' ? 28 : 18;
        const sw = 1.75;

        const middle = () => {
            switch (state) {
                case 'connecting':
                    return <LoaderCircle className="fabi-link-spin" size={size === 'md' ? 20 : 14} strokeWidth={sw} />;
                case 'waiting':
                    return <span className="fabi-link-dots"><i /><i /><i /></span>;
                case 'error':
                    return <Unplug className="fabi-link-err" size={size === 'md' ? 18 : 13} strokeWidth={sw} />;
                default: {
                    const cs = size === 'md' ? 16 : 12;
                    return (
                        <span className="fabi-link-chevs">
                            <ChevronRight size={cs} strokeWidth={2.25} />
                            <ChevronRight size={cs} strokeWidth={2.25} />
                            <ChevronRight size={cs} strokeWidth={2.25} />
                        </span>
                    );
                }
            }
        };

        return (
            <span className={`fabi-link fabi-link-${size} state-${state}`} aria-hidden="true">
                <Laptop className="fabi-link-pc" size={pc} strokeWidth={sw} />
                <span className="fabi-link-mid">{middle()}</span>
                <Server className="fabi-link-pc" size={pc} strokeWidth={sw} />
            </span>
        );
    };

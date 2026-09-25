/*                                                                */
/*       Copyright (c) Project PRISM. All rights reserved.        */
/*         This software is licensed under the CC BY-NC           */
/*          Full text of the license can be found at              */
/*   https://creativecommons.org/licenses/by-nc/4.0/legalcode.en  */
/*                                                                */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class WindowManager {
    constructor(dockInstance = null) {
        this._display = global.display;
        this._dockInstance = dockInstance;
        this._grabBeginId = 0;
        this._grabEndId = 0;
        this._trackTimerId = 0;
        this._draggedWindow = null;
        this._activeTarget = null;

        this._buildSnapUI();
        this._connectSignals();
    }

    _buildSnapUI() {
        this.snapContainer = new St.BoxLayout({
            name: 'prism-snap-assist',
            style: 'background-color: rgba(16, 18, 24, 0.95); border-radius: 0 0 24px 24px; padding: 16px; spacing: 16px; border: 1px solid rgba(255,255,255,0.1); border-top: none;',
            reactive: false,
            visible: false
        });

        this.dropTargets = [];

        let configs = [
            { type: 'full', hasDock: true },
            { type: 'half', hasDock: true },
            { type: 'quarter', hasDock: true },
            { type: 'full', hasDock: false },
            { type: 'half', hasDock: false },
            { type: 'quarter', hasDock: false }
        ];

        for (let config of configs) {
            let cardWidget = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                style: 'background-color: rgba(255,255,255,0.03); border-radius: 12px; border: 2px solid transparent;',
                reactive: false
            });
            cardWidget.set_size(90, 76);
            
            let screen = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                style: 'border: 2px solid rgba(255,255,255,0.3); border-radius: 6px; background-color: rgba(0,0,0,0.4);'
            });
            screen.set_size(64, 42); 
            screen.set_position(13, 17);

            if (config.hasDock) {
                let dock = new St.Widget({ style: 'background-color: rgba(255,255,255,0.3); border-radius: 2px;' });
                dock.set_size(44, 4);
                dock.set_position(10, 36);
                screen.add_child(dock);
            }

            let subZones = [];
            let targetH = config.hasDock ? 32 : 38; 
            
            if (config.type === 'full') {
                subZones.push({ x: 2, y: 2, w: 60, h: targetH, pos: 'full' });
            } else if (config.type === 'half') {
                subZones.push({ x: 2, y: 2, w: 29, h: targetH, pos: 'left' });
                subZones.push({ x: 33, y: 2, w: 29, h: targetH, pos: 'right' });
            } else if (config.type === 'quarter') {
                let qH = (targetH - 2) / 2;
                subZones.push({ x: 2, y: 2, w: 29, h: qH, pos: 'tl' });
                subZones.push({ x: 33, y: 2, w: 29, h: qH, pos: 'tr' });
                subZones.push({ x: 2, y: 2 + qH + 2, w: 29, h: qH, pos: 'bl' });
                subZones.push({ x: 33, y: 2 + qH + 2, w: 29, h: qH, pos: 'br' });
            }

            for (let z of subZones) {
                let targetWidget = new St.Widget({
                    style: 'background-color: rgba(255,255,255,0.15); border-radius: 2px;' 
                });
                targetWidget.set_size(z.w, z.h);
                targetWidget.set_position(z.x, z.y);
                screen.add_child(targetWidget);
                
                this.dropTargets.push({
                    widget: targetWidget,
                    card: cardWidget,
                    type: config.type,
                    hasDock: config.hasDock,
                    pos: z.pos
                });
            }

            cardWidget.add_child(screen);
            this.snapContainer.add_child(cardWidget);
        }

        Main.layoutManager.addChrome(this.snapContainer);
    }

    _connectSignals() {
        this._grabBeginId = this._display.connect('grab-op-begin', (display, window, op) => {
            if (op === Meta.GrabOp.MOVING) {
                this._draggedWindow = window;
                this._showSnapUI();
                this._startTrackingMouse();
            }
        });

        this._grabEndId = this._display.connect('grab-op-end', (display, window, op) => {
            if (op === Meta.GrabOp.MOVING && this._draggedWindow) {
                this._stopTrackingMouse();
                this._hideSnapUI();
                
                if (this._activeTarget) {
                    this._applySnap(this._draggedWindow, this._activeTarget);
                }
                this._draggedWindow = null;
                this._activeTarget = null;
            }
        });
    }

    _showSnapUI() {
        let monitor = Main.layoutManager.primaryMonitor;
        this.snapContainer.set_position((monitor.width - this.snapContainer.width) / 2, monitor.y);
        this.snapContainer.show();
    }

    _hideSnapUI() {
        this.snapContainer.hide();
        this._resetAllTargets();
    }

    _resetAllTargets() {
        for (let target of this.dropTargets) {
            target.widget.set_style('background-color: rgba(255,255,255,0.15); border-radius: 2px;');
            target.card.set_style('background-color: rgba(255,255,255,0.03); border-radius: 12px; border: 2px solid transparent;');
        }
    }

    _startTrackingMouse() {
        if (this._trackTimerId) return;

        this._trackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            let [mouseX, mouseY] = global.get_pointer();
            let newActiveTarget = null;

            for (let target of this.dropTargets) {
                let [cx, cy] = target.card.get_transformed_position();
                let [cw, ch] = target.card.get_transformed_size();

                if (mouseX >= cx && mouseX <= cx + cw && mouseY >= cy && mouseY <= cy + ch) {
                    let siblingTargets = this.dropTargets.filter(t => t.card === target.card);
                    
                    if (siblingTargets.length === 1) {
                        newActiveTarget = siblingTargets[0];
                    } else {
                        let closest = null;
                        let minDst = Infinity;
                        for (let st of siblingTargets) {
                            let [tx, ty] = st.widget.get_transformed_position();
                            let [tw, th] = st.widget.get_transformed_size();
                            let midX = tx + tw / 2;
                            let midY = ty + th / 2;
                            let dst = Math.pow(mouseX - midX, 2) + Math.pow(mouseY - midY, 2);
                            
                            if (dst < minDst) {
                                minDst = dst;
                                closest = st;
                            }
                        }
                        newActiveTarget = closest;
                    }
                    break;
                }
            }

            if (newActiveTarget !== this._activeTarget) {
                this._resetAllTargets();

                if (newActiveTarget) {
                    newActiveTarget.widget.set_style('background-color: #4DD0E1; border-radius: 2px;'); 
                    newActiveTarget.card.set_style('background-color: rgba(77,208,225,0.08); border-radius: 12px; border: 2px solid rgba(77,208,225,0.5);');
                }
                this._activeTarget = newActiveTarget;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTrackingMouse() {
        if (this._trackTimerId) {
            GLib.Source.remove(this._trackTimerId);
            this._trackTimerId = 0;
        }
    }

    _applySnap(window, target) {
        let monitor = window.get_monitor();
        
        let workspace = global.workspace_manager.get_active_workspace();
        let geom = workspace.get_work_area_for_monitor(monitor);
        
        let newX = geom.x;
        let newY = geom.y;
        let newW = geom.width;
        let newH = geom.height;
        
        let dockH = 0;
        if (target.hasDock) {
            if (this._dockInstance && this._dockInstance.container && !isNaN(this._dockInstance.container.height)) {
                dockH = this._dockInstance.container.height + 25;
            } else {
                dockH = 100; 
            }
        }
        
        let usableHeight = Math.max(0, geom.height - dockH);

        switch(target.type) {
            case 'full':
                newH = usableHeight;
                break;
            case 'half':
                newW = Math.round(geom.width / 2);
                newH = usableHeight;
                if (target.pos === 'right') newX = geom.x + newW;
                break;
            case 'quarter':
                newW = Math.round(geom.width / 2);
                newH = Math.round(usableHeight / 2);
                
                if (target.pos === 'tr' || target.pos === 'br') newX = geom.x + newW; 
                if (target.pos === 'bl' || target.pos === 'br') newY = geom.y + newH; 
                break;
        }

        const applyGeometry = () => {
            window.move_resize_frame(true, newX, newY, newW, newH);
        };

        if (window.maximized_vertically || window.maximized_horizontally) {
            window.unmaximize(Meta.MaximizeFlags.BOTH);
            
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                applyGeometry();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            applyGeometry();
        }
    }

    destroy() {
        this._stopTrackingMouse();
        if (this._grabBeginId) this._display.disconnect(this._grabBeginId);
        if (this._grabEndId) this._display.disconnect(this._grabEndId);
        if (this.snapContainer) {
            this.snapContainer.destroy();
            this.snapContainer = null;
        }
    }
}
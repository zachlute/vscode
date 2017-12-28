/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assign } from 'vs/base/common/objects';
import { memoize } from 'vs/base/common/decorators';
import { IDisposable, toDisposable, dispose } from 'vs/base/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { TPromise } from 'vs/base/common/winjs.base';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { BrowserWindow, ipcMain } from 'electron';
import { ISharedProcess } from 'vs/platform/windows/electron-main/windows';
import { Barrier } from 'vs/base/common/async';

export class SharedProcess implements ISharedProcess {

	private barrier = new Barrier();

	private window: Electron.BrowserWindow;
	private disposables: IDisposable[] = [];

	constructor(
		private environmentService: IEnvironmentService,
		private readonly machineId: string,
		private readonly userEnv: IProcessEnvironment
	) { }

	@memoize
	private get _whenReady(): TPromise<void> {
		this.window = new BrowserWindow({
			show: false,
			webPreferences: {
				images: false,
				webaudio: false,
				webgl: false
			}
		});
		const config = assign({
			appRoot: this.environmentService.appRoot,
			machineId: this.machineId,
			nodeCachedDataDir: this.environmentService.nodeCachedDataDir,
			userEnv: this.userEnv
		});

		const url = `${require.toUrl('vs/code/electron-browser/sharedProcess/sharedProcess.html')}?config=${encodeURIComponent(JSON.stringify(config))}`;
		this.window.loadURL(url);

		// Prevent the window from dying
		const onClose = (e: Event) => {
			if (this.window.isVisible()) {
				e.preventDefault();
				this.window.hide();
			}
		};

		this.window.on('close', onClose);
		this.disposables.push(toDisposable(() => this.window.removeListener('close', onClose)));

		this.disposables.push(toDisposable(() => {

			// Electron seems to crash on Windows without this setTimeout :|
			setTimeout(() => {
				try {
					this.window.close();
				} catch (err) {
					// ignore, as electron is already shutting down
				}

				this.window = null;
			}, 0);
		}));

		return new TPromise<void>((c, e) => {
			ipcMain.once('handshake:hello', ({ sender }: { sender: any }) => {
				sender.send('handshake:hey there', {
					sharedIPCHandle: this.environmentService.sharedIPCHandle,
					args: this.environmentService.args
				});

				ipcMain.once('handshake:im ready', () => c(null));
			});
		});
	}

	spawn(): void {
		this.barrier.open();
	}

	whenReady(): TPromise<void> {
		return this.barrier.wait().then(() => this._whenReady);
	}

	toggle(): void {
		if (this.window.isVisible()) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		this.window.show();
		this.window.webContents.openDevTools();
	}

	hide(): void {
		this.window.webContents.closeDevTools();
		this.window.hide();
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

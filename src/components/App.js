import url from 'url';

import { remote } from 'electron';
import i18n from 'i18next';
import React, { useEffect, useState, useMemo } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { call, put, select, take, takeEvery } from 'redux-saga/effects';

import {
	MENU_BAR_QUIT_CLICKED,
	MENU_BAR_ABOUT_CLICKED,
	MENU_BAR_OPEN_URL_CLICKED,
	MENU_BAR_RESET_APP_DATA_CLICKED,
	MENU_BAR_TOGGLE_SETTING_CLICKED,
	ABOUT_DIALOG_DISMISSED,
	UPDATE_DIALOG_DISMISSED,
	SCREEN_SHARING_DIALOG_DISMISSED,
	TRAY_ICON_QUIT_CLICKED,
	WEBVIEW_SCREEN_SHARING_SOURCE_REQUESTED,
	MAIN_WINDOW_STATE_CHANGED,
	UPDATES_NEW_VERSION_AVAILABLE,
	SCREEN_SHARING_DIALOG_SOURCE_SELECTED,
	DEEP_LINK_TRIGGERED,
	DEEP_LINKS_SERVER_FOCUSED,
	DEEP_LINKS_SERVER_ADDED,
} from '../actions';
import { MainWindow } from './MainWindow';
import { AboutDialog } from './AboutDialog';
import { ScreenSharingDialog } from './ScreenSharingDialog';
import { UpdateDialog } from './UpdateDialog';
import { SideBar } from './SideBar';
import { ServersView } from './ServersView';
import { AddServerView } from './AddServerView';
import { TrayIcon } from './TrayIcon';
import { MenuBar } from './MenuBar';
import { Dock } from './Dock';
import { TouchBar } from './TouchBar';
import { createReduxStoreAndSagaMiddleware } from '../storeAndEffects';
import { SagaMiddlewareProvider, useSaga } from './SagaMiddlewareProvider';
import { validateServerUrl } from '../sagas/servers';

function AppContent() {
	const { t } = useTranslation();

	const [loading, setLoading] = useState(true);
	const [showWindowOnUnreadChanged, setShowWindowOnUnreadChanged] =	useState(() => localStorage.getItem('showWindowOnUnreadChanged') === 'true');
	const [hasTrayIcon, setHasTrayIcon] =	useState(() => (localStorage.getItem('hideTray') ? localStorage.getItem('hideTray') !== 'true' : process.platform !== 'linux'));
	const [hasMenuBar, setHasMenuBar] = useState(() => localStorage.getItem('autohideMenu') !== 'true');
	const [hasSidebar, setHasSidebar] = useState(() => localStorage.getItem('sidebar-closed') !== 'true');
	const _servers = useSelector(({ servers }) => servers);
	const currentServerUrl = useSelector(({ currentServerUrl }) => currentServerUrl);
	const badges = useSelector(({ servers }) => servers.reduce((badges, { url, badge }) => ({ ...badges, [url]: badge }), {}));
	const styles = useSelector(({ servers }) => servers.reduce((styles, { url, style }) => ({ ...styles, [url]: style }), {}));
	const [newUpdateVersion, setNewUpdateVersion] = useState(null);
	const [mainWindowState, setMainWindowState] = useState({});
	const [openDialog, setOpenDialog] = useState(null);
	const [offline, setOffline] = useState(false);

	const globalBadge = useMemo(() => {
		const mentionCount = Object.values(badges)
			.filter((badge) => Number.isInteger(badge))
			.reduce((sum, count) => sum + count, 0);
		return mentionCount || (Object.values(badges).some((badge) => !!badge) && '•') || null;
	}, [badges]);

	// eslint-disable-next-line complexity
	useSaga(function *() {
		yield takeEvery([MENU_BAR_QUIT_CLICKED, TRAY_ICON_QUIT_CLICKED], function *() {
			remote.app.quit();
		});

		yield takeEvery(DEEP_LINK_TRIGGERED, function *({ payload: { url } }) {
			const servers = yield select(({ servers }) => servers);

			if (servers.some((server) => server.url === url)) {
				yield put({ type: DEEP_LINKS_SERVER_FOCUSED, payload: url });
				return;
			}

			const { response } = yield call(::remote.dialog.showMessageBox, {
				type: 'question',
				buttons: [t('dialog.addServer.add'), t('dialog.addServer.cancel')],
				defaultId: 0,
				title: t('dialog.addServer.title'),
				message: t('dialog.addServer.message', { host: url }),
			});

			if (response === 0) {
				try {
					yield *validateServerUrl(url);
					yield put({ type: DEEP_LINKS_SERVER_ADDED, payload: url });
				} catch (error) {
					remote.dialog.showErrorBox(t('dialog.addServerError.title'), t('dialog.addServerError.message', { host: url }));
				}
			}
		});

		while (true) {
			const { type, payload } = yield take();

			if (type === MENU_BAR_ABOUT_CLICKED) {
				setOpenDialog('about');
				continue;
			}

			if (type === MENU_BAR_OPEN_URL_CLICKED) {
				const url = payload;
				remote.shell.openExternal(url);
				continue;
			}

			if (type === MENU_BAR_RESET_APP_DATA_CLICKED) {
				const { response } = yield call(::remote.dialog.showMessageBox, {
					type: 'question',
					buttons: [t('dialog.resetAppData.yes'), t('dialog.resetAppData.cancel')],
					defaultId: 1,
					title: t('dialog.resetAppData.title'),
					message: t('dialog.resetAppData.message'),
				});

				if (response !== 0) {
					continue;
				}

				remote.app.relaunch({ args: [remote.process.argv[1], '--reset-app-data'] });
				remote.app.quit();
				continue;
			}

			if (type === MENU_BAR_TOGGLE_SETTING_CLICKED) {
				const property = payload;

				switch (property) {
					case 'showTrayIcon': {
						const previousValue = localStorage.getItem('hideTray') !== 'true';
						const newValue = !previousValue;
						localStorage.setItem('hideTray', JSON.stringify(!newValue));
						setHasTrayIcon(newValue);
						break;
					}

					case 'showWindowOnUnreadChanged': {
						const previousValue = localStorage.getItem('showWindowOnUnreadChanged') === 'true';
						const newValue = !previousValue;
						localStorage.setItem('showWindowOnUnreadChanged', JSON.stringify(newValue));
						setShowWindowOnUnreadChanged(newValue);
						break;
					}

					case 'showMenuBar': {
						const previousValue = localStorage.getItem('autohideMenu') !== 'true';
						const newValue = !previousValue;
						localStorage.setItem('autohideMenu', JSON.stringify(!newValue));
						setHasMenuBar(newValue);
						break;
					}

					case 'showServerList': {
						const previousValue = localStorage.getItem('sidebar-closed') !== 'true';
						const newValue = !previousValue;
						localStorage.setItem('sidebar-closed', JSON.stringify(!newValue));
						setHasSidebar(newValue);
						break;
					}
				}
				continue;
			}

			if (type === ABOUT_DIALOG_DISMISSED) {
				setOpenDialog(null);
				continue;
			}

			if (type === UPDATE_DIALOG_DISMISSED) {
				setOpenDialog(null);
				continue;
			}

			if (type === SCREEN_SHARING_DIALOG_DISMISSED) {
				setOpenDialog(null);
				continue;
			}

			if (type === SCREEN_SHARING_DIALOG_SOURCE_SELECTED) {
				setOpenDialog(null);
				continue;
			}

			if (type === WEBVIEW_SCREEN_SHARING_SOURCE_REQUESTED) {
				setOpenDialog('screen-sharing');
				continue;
			}

			if (type === MAIN_WINDOW_STATE_CHANGED) {
				setMainWindowState(payload);
				continue;
			}

			if (type === UPDATES_NEW_VERSION_AVAILABLE) {
				setNewUpdateVersion(payload);
				setOpenDialog('update');
				continue;
			}
		}
	}, []);

	useEffect(() => {
		const handleConnectionStatus = () => {
			setOffline(!navigator.onLine);
		};

		handleConnectionStatus();

		window.addEventListener('online', handleConnectionStatus);
		window.addEventListener('offline', handleConnectionStatus);

		return () => {
			window.removeEventListener('online', handleConnectionStatus);
			window.removeEventListener('offline', handleConnectionStatus);
		};
	}, []);

	const dispatch = useDispatch();

	useEffect(() => {
		setLoading(false);
	}, []);

	useEffect(() => {
		const handleLogin = (event, webContents, request, authInfo, callback) => {
			for (const server of _servers) {
				const { host: serverHost, auth } = url.parse(server.url);
				const requestHost = url.parse(request.url).host;

				if (serverHost !== requestHost || !auth) {
					callback();
					return;
				}

				const [username, password] = auth.split(/:/);
				callback(username, password);
			}
		};

		remote.app.addListener('login', handleLogin);

		const unsubscribe = () => {
			remote.app.removeListener('login', handleLogin);
		};

		return unsubscribe;
	}, [_servers]);

	useEffect(() => {
		window.dispatch = dispatch;
	}, [dispatch]);

	return <MainWindow
		badge={hasTrayIcon ? undefined : globalBadge}
		loading={loading}
		offline={offline}
		showWindowOnUnreadChanged={showWindowOnUnreadChanged}
	>
		<MenuBar
			showTrayIcon={hasTrayIcon}
			showFullScreen={mainWindowState.fullscreen}
			showWindowOnUnreadChanged={showWindowOnUnreadChanged}
			showMenuBar={hasMenuBar}
			showServerList={hasSidebar}
			servers={_servers}
			currentServerUrl={currentServerUrl}
		/>
		<SideBar
			servers={_servers}
			currentServerUrl={currentServerUrl}
			badges={badges}
			visible={_servers.length > 0 && hasSidebar}
			styles={styles}
		/>
		<ServersView
			servers={_servers}
			currentServerUrl={currentServerUrl}
			hasSidebar={_servers.length > 0 && hasSidebar}
		/>
		<AddServerView
			visible={currentServerUrl === null}
		/>
		<AboutDialog
			visible={openDialog === 'about'}
		/>
		<UpdateDialog
			newVersion={newUpdateVersion}
			visible={openDialog === 'update'}
		/>
		<ScreenSharingDialog
			visible={openDialog === 'screen-sharing'}
		/>
		<Dock
			badge={globalBadge}
		/>
		<TrayIcon
			badge={globalBadge}
			show={!mainWindowState.visible || !mainWindowState.focused}
			visible={hasTrayIcon}
		/>
		<TouchBar
			servers={_servers}
			currentServerUrl={currentServerUrl}
		/>
	</MainWindow>;
}

export function App() {
	const [[store, sagaMiddleware]] = useState(() => createReduxStoreAndSagaMiddleware());

	return <Provider store={store}>
		<SagaMiddlewareProvider sagaMiddleware={sagaMiddleware}>
			<I18nextProvider i18n={i18n}>
				<AppContent />
			</I18nextProvider>
		</SagaMiddlewareProvider>
	</Provider>;
}

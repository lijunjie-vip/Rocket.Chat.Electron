import fs from 'fs';
import path from 'path';
import url from 'url';

import { remote } from 'electron';
import { eventChannel } from 'redux-saga';
import { call, put, takeEvery } from 'redux-saga/effects';

import { readMap, writeMap } from '../localStorage';
import {
	CERTIFICATES_CLEARED,
	CERTIFICATES_UPDATED,
	MENU_BAR_CLEAR_TRUSTED_CERTIFICATES_CLICKED,
	WEBVIEW_CERTIFICATE_DENIED,
	WEBVIEW_CERTIFICATE_TRUSTED,
	CERTIFICATE_TRUST_REQUESTED,
} from '../actions';

let trustedCertificates = new Map();

const loadTrustedCertificates = async () => {
	const trustedCertificates = readMap('trustedCertificates');

	try {
		const certificatesFilePath = path.join(remote.app.getPath('userData'), 'certificate.json');

		if (await fs.promises.stat(certificatesFilePath).then((stat) => stat.isFile(), () => false)) {
			const mapping = JSON.parse(await fs.promises.readFile(certificatesFilePath, 'utf8'));

			for (const [key, value] of Object.entries(mapping)) {
				trustedCertificates.set(key, String(value));
			}

			await fs.promises.unlink(certificatesFilePath);
		}
	} catch (error) {
		console.error(error.stack);
	}

	return trustedCertificates;
};

const serializeCertificate = (certificate) => `${ certificate.issuerName }\n${ certificate.data.toString() }`;

const queuedTrustRequests = new Map();

function *handleCertificateError([, webContents, requestedUrl, error, certificate, callback]) {
	const serialized = serializeCertificate(certificate);
	const { host } = url.parse(requestedUrl);

	const isTrusted = trustedCertificates.has(host) && trustedCertificates.get(host) === serialized;

	if (isTrusted) {
		callback(true);
		return;
	}

	if (queuedTrustRequests.has(certificate.fingerprint)) {
		queuedTrustRequests.get(certificate.fingerprint).push(callback);
		return;
	}

	const commit = (trusted) => {
		if (!trusted) {
			return;
		}

		trustedCertificates.set(host, serialized);
		writeMap('trustedCertificates', trustedCertificates);
	};

	queuedTrustRequests.set(certificate.fingerprint, [commit, callback]);

	yield put({
		type: CERTIFICATE_TRUST_REQUESTED,
		payload: {
			webContentsId: webContents.id,
			requestedUrl,
			error,
			fingerprint: certificate.fingerprint,
			issuerName: certificate.issuerName,
			willBeReplaced: trustedCertificates.has(host),
		},
	});
}

function *takeAppEvents() {
	const createAppChannel = (app, eventName) => eventChannel((emit) => {
		const listener = (...args) => emit(args);

		const cleanUp = () => {
			app.removeListener(eventName, listener);
			window.removeEventListener('beforeunload', cleanUp);
		};

		app.addListener(eventName, listener);
		window.addEventListener('beforeunload', cleanUp);

		return cleanUp;
	});

	const certificateErrorChannel = createAppChannel(remote.app, 'certificate-error');
	const selectClientCertificateChannel = createAppChannel(remote.app, 'select-client-certificate');

	yield takeEvery(certificateErrorChannel, handleCertificateError);

	yield takeEvery(selectClientCertificateChannel, function *() {
		// TODO
	});
}

function *takeActions() {
	yield takeEvery(MENU_BAR_CLEAR_TRUSTED_CERTIFICATES_CLICKED, function *() {
		trustedCertificates.clear();
		writeMap('trustedCertificates', trustedCertificates);
		yield put({ type: CERTIFICATES_CLEARED });
	});

	yield takeEvery(WEBVIEW_CERTIFICATE_TRUSTED, function *({ payload: { fingerprint } }) {
		queuedTrustRequests.get(fingerprint).forEach((cb) => cb(true));
		queuedTrustRequests.delete(fingerprint);
		yield put({ type: CERTIFICATES_UPDATED });
	});

	yield takeEvery(WEBVIEW_CERTIFICATE_DENIED, function *({ payload: { fingerprint } }) {
		queuedTrustRequests.get(fingerprint).forEach((cb) => cb(false));
		queuedTrustRequests.delete(fingerprint);
	});
}

export function *certificatesSaga() {
	trustedCertificates = yield call(loadTrustedCertificates);
	yield takeAppEvents();
	yield *takeActions();
}

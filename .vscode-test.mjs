import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Keep webview probes responsive when another window has focus during tests.
	launchArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
	...(process.env.FLOWRIDER_TEST_CODE ? { useInstallation: { fromPath: process.env.FLOWRIDER_TEST_CODE } } : {}),
});

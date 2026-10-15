/** Online/offline detection + install prompt handling. */

import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('tg_install_dismissed') === '1',
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // iOS standalone detection
    if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('tg_install_dismissed', '1');
  };

  // Platform differences: Chrome/Edge show the event; iOS Safari needs manual instructions.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return {
    canPrompt: !!deferred,
    installed,
    dismissed,
    promptInstall,
    dismiss,
    isIOS,
    showHelp: !installed && !dismissed && (isIOS || !!deferred),
  };
}

/** Install prompt: platform-aware (beforeinstallprompt vs iOS Share instructions). */

import { Download, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  canPrompt: boolean;
  installed: boolean;
  dismissed: boolean;
  isIOS: boolean;
  showHelp: boolean;
  promptInstall: () => Promise<void>;
  dismiss: () => void;
};

export function InstallPrompt(props: Props) {
  const { t } = useI18n();
  if (props.installed || props.dismissed || !props.showHelp) return null;

  return (
    <div
      role="dialog"
      aria-label={t('install.title')}
      className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-2xl border border-brand-200 bg-white p-4 shadow-lg md:bottom-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
          <Download className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-900">{t('install.title')}</p>
          <p className="mt-0.5 text-sm text-stone-600">{t('install.body')}</p>
          {props.isIOS && <p className="mt-1 text-sm text-stone-500">{t('install.ios_hint')}</p>}
          <div className="mt-3 flex gap-2">
            {props.canPrompt && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void props.promptInstall()}
              >
                {t('action.confirm')}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={props.dismiss}>
              {t('install.dismiss')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={props.dismiss}
          className="rounded-lg p-1 text-stone-400 hover:text-stone-700"
          aria-label={t('action.close')}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

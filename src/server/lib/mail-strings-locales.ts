/** Dutch, French and German email template strings; English is the fallback. */

import type { TemplateStrings } from './mail-strings-en';

export const mailStringsNl: TemplateStrings = {
  verify_email: {
    subject: 'Bevestig je Traugily e-mailadres',
    body: 'Welkom bij Traugily! Bevestig je e-mailadres via deze link: {{link}}\n\nDeze link verloopt na 24 uur. Als je geen account hebt aangemaakt, kun je deze e-mail negeren.',
  },
  reset_password: {
    subject: 'Reset je Traugily wachtwoord',
    body: 'Gebruik deze link om een nieuw wachtwoord te kiezen: {{link}}\n\nDeze link verloopt na 1 uur. Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.',
  },
  welcome: {
    subject: 'Welkom bij Traugily',
    body: 'Bedankt voor het lid worden van Traugily! Je training, voeding en herstel-coaching begint met een korte onboarding.',
  },
  payment_success: {
    subject: 'Betaling Traugily-abonnement',
    body: 'We hebben je betaling van {{amount}} ({{currency}}) ontvangen. Je factuur: {{invoiceUrl}}',
  },
  payment_failed: {
    subject: 'Actie nodig: betaling Traugily mislukt',
    body: 'We konden je betaling van {{amount}} ({{currency}}) niet verwerken.\n\nWerk je betaalgegevens bij: {{portalUrl}}\n\nWe herinneren je dagelijks totdat het is opgelost. Na 14 dagen eindigt het abonnement, maar je gegevens blijven veilig en exporteerbaar.',
  },
  subscription_canceled: {
    subject: 'Je Traugily-abonnement is beëindigd',
    body: 'Je abonnement is beëindigd na 14 dagen onbetaalde facturen. Je gegevens zijn bewaard — je kunt ze exporteren of je opnieuw abonneren.',
  },
  report_ready: {
    subject: 'Je Traugily-rapport is klaar',
    body: 'Je voortgangsrapport voor {{period}} is klaar om te downloaden: {{link}}',
  },
  account_deleted: {
    subject: 'Je Traugily-account is verwijderd',
    body: 'Je account en persoonlijke gegevens zijn op verzoek verwijderd.',
  },
};

export const mailStringsFr: TemplateStrings = {
  verify_email: {
    subject: 'Vérifiez votre e-mail Traugily',
    body: 'Bienvenue chez Traugily ! Confirmez votre adresse e-mail via ce lien : {{link}}\n\nCe lien expire dans 24 heures.',
  },
  reset_password: {
    subject: 'Réinitialisez votre mot de passe Traugily',
    body: 'Utilisez ce lien pour choisir un nouveau mot de passe : {{link}}\n\nCe lien expire dans 1 heure.',
  },
  welcome: {
    subject: 'Bienvenue chez Traugily',
    body: 'Merci de rejoindre Traugily ! Votre accompagnement commence par une courte inscription.',
  },
  payment_success: {
    subject: 'Paiement de votre abonnement Traugily',
    body: 'Nous avons bien reçu votre paiement de {{amount}} ({{currency}}). Votre facture : {{invoiceUrl}}',
  },
  payment_failed: {
    subject: 'Action requise : paiement Traugily échoué',
    body: 'Nous n’avons pas pu traiter votre paiement de {{amount}} ({{currency}}).\n\nMettez à jour vos informations de paiement : {{portalUrl}}\n\nNous vous rappellerons chaque jour. Après 14 jours impayés, l’abonnement prendra fin, mais vos données resteront disponibles.',
  },
  subscription_canceled: {
    subject: 'Votre abonnement Traugily est terminé',
    body: 'Votre abonnement s’est terminé après 14 jours de factures impayées. Vos données sont conservées.',
  },
  report_ready: {
    subject: 'Votre rapport Traugily est prêt',
    body: 'Votre rapport de progression pour {{period}} est prêt : {{link}}',
  },
  account_deleted: {
    subject: 'Votre compte Traugily a été supprimé',
    body: 'Votre compte et vos données personnelles ont été supprimés à votre demande.',
  },
};

export const mailStringsDe: TemplateStrings = {
  verify_email: {
    subject: 'Bestätige deine Traugily E-Mail',
    body: 'Willkommen bei Traugily! Bestätige deine E-Mail-Adresse über diesen Link: {{link}}\n\nDer Link läuft in 24 Stunden ab.',
  },
  reset_password: {
    subject: 'Traugily Passwort zurücksetzen',
    body: 'Nutze diesen Link, um ein neues Passwort zu wählen: {{link}}\n\nDer Link läuft in 1 Stunde ab.',
  },
  welcome: {
    subject: 'Willkommen bei Traugily',
    body: 'Danke, dass du Traugily beigetreten bist! Dein Training, Ernährung und Recovery beginnt mit einem kurzen Onboarding.',
  },
  payment_success: {
    subject: 'Zahlung deines Traugily-Abos',
    body: 'Wir haben deine Zahlung von {{amount}} ({{currency}}) erhalten. Deine Rechnung: {{invoiceUrl}}',
  },
  payment_failed: {
    subject: 'Handlung nötig: Traugily-Zahlung fehlgeschlagen',
    body: 'Wir konnten deine Zahlung von {{amount}} ({{currency}}) nicht verarbeiten.\n\nAktualisiere deine Zahlungsdaten: {{portalUrl}}\n\nWir erinnern dich täglich. Nach 14 Tagen ohne Zahlung endet das Abo, aber deine Daten bleiben sicher und exportierbar.',
  },
  subscription_canceled: {
    subject: 'Dein Traugily-Abo ist beendet',
    body: 'Dein Abo endete nach 14 Tagen unbezahlter Rechnungen. Deine Daten sind erhalten.',
  },
  report_ready: {
    subject: 'Dein Traugily-Bericht ist bereit',
    body: 'Dein Fortschrittsbericht für {{period}} ist bereit: {{link}}',
  },
  account_deleted: {
    subject: 'Dein Traugily-Konto wurde gelöscht',
    body: 'Dein Konto und deine persönlichen Daten wurden auf Anfrage gelöscht.',
  },
};

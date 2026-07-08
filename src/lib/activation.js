// ---------------------------------------------------------------------------
// Verrouillage par appareil (licence) — version Android.
//
// Chaque installation doit être activée avec un code. Un code ne fonctionne
// que sur UN seul téléphone (identifiant Android stable, survivant à la
// réinstallation). Toute la validation se fait côté base via des fonctions
// sécurisées (voir supabase/device-licenses.sql). Sur le web (aperçu), aucun
// verrou : Capacitor n'est pas natif.
// ---------------------------------------------------------------------------

import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import { supabase } from './supabase';

const CODE_KEY = 'boulange-activation-code';

export function isNative() {
  return Capacitor.isNativePlatform();
}

let deviceIdCache = null;
export async function getDeviceId() {
  if (deviceIdCache) return deviceIdCache;
  const { identifier } = await Device.getId();
  deviceIdCache = identifier;
  return identifier;
}

async function getStoredCode() {
  const { value } = await Preferences.get({ key: CODE_KEY });
  return value || null;
}

// 'ok' → appareil autorisé ; 'need_code' → activation requise.
// En cas d'erreur réseau alors qu'un code est déjà mémorisé, on ne bloque pas
// (l'application a de toute façon besoin du réseau pour ses données).
export async function checkActivation() {
  if (!isNative()) return 'ok';
  const code = await getStoredCode();
  if (!code) return 'need_code';
  try {
    const deviceId = await getDeviceId();
    const { data, error } = await supabase.rpc('verify_device', {
      p_code: code,
      p_device_id: deviceId
    });
    if (error) return 'ok'; // réseau/serveur indisponible : appareil déjà activé
    return data?.ok ? 'ok' : 'need_code';
  } catch {
    return 'ok';
  }
}

// { ok: true } | { ok: false, reason: 'invalide' | 'autre_appareil' | 'service' }
export async function activateWithCode(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) return { ok: false, reason: 'invalide' };
  try {
    const deviceId = await getDeviceId();
    const { data, error } = await supabase.rpc('activate_device', {
      p_code: code,
      p_device_id: deviceId
    });
    if (error) return { ok: false, reason: 'service' };
    if (data?.ok) {
      await Preferences.set({ key: CODE_KEY, value: code });
      return { ok: true };
    }
    return { ok: false, reason: data?.reason || 'invalide' };
  } catch {
    return { ok: false, reason: 'service' };
  }
}

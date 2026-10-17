import { useState } from 'react';
import type { UserProfile } from '../types';

const storageKey = 'llm-screenwriter.profile.v1';
const defaultProfile: UserProfile = {
  display_name: 'Radek', email: 'radek@example.com', avatar_url: null, preferred_language: 'pl',
};

export function isAvatarUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length < 3_000_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function loadProfile(): UserProfile {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<UserProfile> | null;
    return {
      ...defaultProfile,
      display_name: typeof value?.display_name === 'string' && value.display_name.trim() ? value.display_name.trim().slice(0, 80) : defaultProfile.display_name,
      avatar_url: isAvatarUrl(value?.avatar_url) ? value.avatar_url : null,
    };
  } catch { return { ...defaultProfile }; }
}

export function useProfile() {
  const [profile, setProfile] = useState(loadProfile);
  function saveProfile(next: Pick<UserProfile, 'display_name' | 'avatar_url'>) {
    const name = next.display_name.trim();
    if (!name || name.length > 80 || (next.avatar_url !== null && !isAvatarUrl(next.avatar_url))) return false;
    const value: UserProfile = { ...profile, display_name: name, avatar_url: next.avatar_url };
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      setProfile(value);
      return true;
    } catch { return false; }
  }
  return { profile, saveProfile };
}

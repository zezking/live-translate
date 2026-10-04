import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-context.js';

describe('AuthContext', () => {
  beforeEach(() => sessionStorage.clear());

  it('persists adminKey to sessionStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.setAdminKey('hunter2'));
    expect(result.current.adminKey).toBe('hunter2');
    expect(sessionStorage.getItem('adminKey')).toBe('hunter2');
  });

  it('clear removes adminKey', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => result.current.setAdminKey('hunter2'));
    act(() => result.current.clear());
    expect(result.current.adminKey).toBe('');
    expect(sessionStorage.getItem('adminKey')).toBeNull();
  });
});

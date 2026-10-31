function getToken() {
  return localStorage.getItem('fdc_token') || '';
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('fdc_user') || 'null');
  } catch {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem('fdc_token', token);
  localStorage.setItem('fdc_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('fdc_token');
  localStorage.removeItem('fdc_user');
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + getToken()
  };
}

async function requireAuth() {
  const token = getToken();
  if (!token) {
    location.href = '/';
    return null;
  }
  try {
    const res = await fetch('/api/me', { headers: authHeaders() });
    if (!res.ok) {
      clearSession();
      location.href = '/';
      return null;
    }
    const data = await res.json();
    setSession(token, data.user);
    return data.user;
  } catch {
    clearSession();
    location.href = '/';
    return null;
  }
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', headers: authHeaders() });
  } catch (_) {}
  clearSession();
  location.href = '/';
}

const ROLE_LABELS = {
  owner: 'Dono',
  admin: 'Administrador',
  moderator: 'Moderador',
  member: 'Membro',
  guest: 'Convidado'
};

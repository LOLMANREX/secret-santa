// État global de l'application
const state = {
  token: localStorage.getItem('secret_santa_token') || null,
  user: null,
  sessions: [],
  currentSession: null,
  selectedAvatar: '🎅',
  initialAction: 'join', // 'join' | 'create' | 'none'
  isTargetRevealed: false,
  snowEnabled: true
};

// Utilitaires DOM & Toast
const $ = (id) => document.getElementById(id);

function showToast(message, isError = false) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.innerHTML = `<span>${isError ? '⚠️' : '🎄'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateFR(dateStr) {
  if (!dateStr) return 'Noël 2026';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Requête API générique
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

// ==================== GESTION DES VUES ====================
function switchView(viewName) {
  $('auth-view').classList.add('hidden');
  $('dashboard-view').classList.add('hidden');
  $('session-view').classList.add('hidden');

  if (viewName === 'auth') {
    $('auth-view').classList.remove('hidden');
    $('nav-user-area').classList.add('hidden');
  } else if (viewName === 'dashboard') {
    $('dashboard-view').classList.remove('hidden');
    $('nav-user-area').classList.remove('hidden');
    renderDashboard();
  } else if (viewName === 'session') {
    $('session-view').classList.remove('hidden');
    $('nav-user-area').classList.remove('hidden');
    renderSessionDetail();
  }
}

function updateNavbarUser() {
  if (state.user) {
    $('nav-user-avatar').textContent = state.user.avatar || '🎅';
    $('nav-user-name').textContent = state.user.name;
    $('dashboard-welcome').textContent = `Ho Ho Ho ! Bonjour ${state.user.name} ${state.user.avatar || '🎅'}`;
  }
}

// ==================== CHARGEMENT DU PROFIL & DES SESSIONS ====================
async function loadProfileAndSessions(openSessionId = null) {
  if (!state.token) {
    switchView('auth');
    return;
  }
  try {
    const data = await apiFetch('/api/me');
    state.user = data.user;
    state.sessions = data.sessions || [];
    updateNavbarUser();

    if (openSessionId) {
      const target = state.sessions.find(s => s.id === openSessionId);
      if (target) {
        state.currentSession = target;
        state.isTargetRevealed = false;
        switchView('session');
        return;
      }
    }
    switchView('dashboard');
  } catch (err) {
    localStorage.removeItem('secret_santa_token');
    state.token = null;
    state.user = null;
    switchView('auth');
  }
}

// ==================== RENDU DU TABLEAU DE BORD ====================
function renderDashboard() {
  const grid = $('sessions-grid');
  const emptyState = $('sessions-empty-state');
  grid.innerHTML = '';

  if (!state.sessions || state.sessions.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  state.sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';
    const isDrawn = session.status === 'drawn';

    let drawBannerHtml = '';
    if (isDrawn && session.myAssignment) {
      drawBannerHtml = `
        <div class="my-draw-preview">
          <div>
            <div style="font-size: 0.75rem; color: var(--gold-light); text-transform: uppercase; font-weight: 700;">
              🎁 Votre tirage est prêt !
            </div>
            <div style="font-size: 0.88rem; color: #fff;">
              Cliquez pour révéler votre cible secrète
            </div>
          </div>
          <span style="font-size: 1.5rem;">🔒</span>
        </div>
      `;
    } else {
      drawBannerHtml = `
        <div style="margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.04); font-size: 0.84rem; color: var(--snow-muted);">
          ${session.isCreator
            ? '👑 Vous êtes l\'organisateur — Lancez le tirage quand tout le monde est là !'
            : '⏳ En attente que l\'organisateur lance le tirage au sort.'}
        </div>
      `;
    }

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <span class="session-status-badge ${isDrawn ? 'status-drawn' : 'status-open'}">
            ${isDrawn ? '✨ Tirage effectué' : '⏳ Inscriptions ouvertes'}
          </span>
          <span class="session-code-pill" title="Code d'invitation">${escapeHtml(session.code)}</span>
        </div>
        <h3 class="session-card-title">${escapeHtml(session.name)}</h3>
        <div class="session-meta">
          <span>🧝 ${session.participantCount} participant${session.participantCount > 1 ? 's' : ''}</span>
          <span>💶 Budget : ${escapeHtml(session.budget)}</span>
          <span>📅 ${formatDateFR(session.eventDate)}</span>
        </div>
      </div>
      ${drawBannerHtml}
    `;

    card.addEventListener('click', () => {
      openSessionDetail(session.id);
    });

    grid.appendChild(card);
  });
}

async function openSessionDetail(sessionId) {
  try {
    const data = await apiFetch(`/api/sessions/${sessionId}`);
    state.currentSession = data.session;
    // Mettre à jour dans la liste locale
    const idx = state.sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) state.sessions[idx] = data.session;
    state.isTargetRevealed = false;
    switchView('session');
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== RENDU DÉTAILLÉ D'UNE SESSION ====================
function renderSessionDetail() {
  const s = state.currentSession;
  if (!s) return;

  $('detail-session-code').textContent = s.code;
  $('detail-inline-code').textContent = s.code;
  $('detail-session-title').textContent = s.name;
  $('detail-session-desc').textContent = s.description || 'Préparez vos plus beaux papiers cadeaux sous le sapin !';
  $('detail-session-budget').textContent = s.budget || 'Libre';
  $('detail-session-date').textContent = formatDateFR(s.eventDate);
  $('detail-participant-count').textContent = s.participantCount;
  $('my-wishlist-input').value = s.myWishlist || '';

  const badge = $('detail-status-badge');
  if (s.status === 'drawn') {
    badge.className = 'session-status-badge status-drawn';
    badge.textContent = '✨ Tirage au sort effectué';
  } else {
    badge.className = 'session-status-badge status-open';
    badge.textContent = '⏳ En attente du tirage au sort';
  }

  renderSecretDrawArea(s);
  renderParticipantsList(s);
  renderExclusionsArea(s);
}

function renderSecretDrawArea(s) {
  const container = $('secret-draw-container');

  // CAS 1 : Le tirage au sort n'a pas encore été lancé
  if (s.status !== 'drawn') {
    const canDraw = s.participantCount >= 2;
    container.innerHTML = `
      <div style="font-size: 3.6rem; margin-bottom: 10px;">🎅</div>
      <h2 style="font-family: 'Mountains of Christmas', cursive; font-size: 2.1rem; color: var(--gold-light); margin-bottom: 8px;">
        Tirage au Sort en Préparation
      </h2>
      <p style="color: var(--snow-muted); max-width: 460px; margin: 0 auto 20px; font-size: 0.94rem;">
        Actuellement <strong>${s.participantCount} participant${s.participantCount > 1 ? 's' : ''}</strong> inscrit${s.participantCount > 1 ? 's' : ''}.
        Partagez le code <strong style="color: var(--gold);">${escapeHtml(s.code)}</strong> à tous les participants avant de lancer le tirage !
      </p>
      ${
        s.isCreator
          ? `
            <button class="btn btn-primary" id="trigger-draw-btn" ${!canDraw ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''} style="font-size: 1.05rem; padding: 14px 26px;">
              🎲 Lancer le tirage au sort secret maintenant !
            </button>
            ${!canDraw ? '<p style="font-size: 0.8rem; color: #fca5a5; margin-top: 10px;">Il faut au moins 2 participants inscrits pour tirer au sort.</p>' : ''}
          `
          : `
            <div style="display: inline-block; padding: 10px 18px; border-radius: 12px; background: rgba(255,255,255,0.06); color: var(--gold-light); font-size: 0.9rem;">
              ⏳ Seul l'organisateur de la session peut lancer le tirage au sort.
            </div>
          `
      }
    `;

    const drawBtn = $('trigger-draw-btn');
    if (drawBtn && canDraw) {
      drawBtn.addEventListener('click', handleTriggerDraw);
    }
    return;
  }

  // CAS 2 : Le tirage a eu lieu ! On affiche le cadeau secret de l'utilisateur connecté
  const target = s.myAssignment;
  if (!target) {
    container.innerHTML = `<p>Aucune attribution trouvée pour votre compte dans cette session.</p>`;
    return;
  }

  if (!state.isTargetRevealed) {
    container.innerHTML = `
      <div class="gift-icon-animated" id="gift-reveal-trigger" title="Cliquez pour ouvrir votre cadeau secret">🎁</div>
      <h2 style="font-family: 'Mountains of Christmas', cursive; font-size: 2.2rem; color: var(--gold-light); margin: 8px 0 6px;">
        Votre mission Père Noël est prête !
      </h2>
      <p style="color: var(--snow-muted); font-size: 0.92rem; max-width: 440px; margin: 0 auto 20px;">
        Assurez-vous que personne ne regarde votre écran par-dessus votre épaule, puis cliquez ci-dessous pour découvrir à qui vous offrez un cadeau !
      </p>
      <button class="btn btn-gold" id="reveal-target-btn" style="font-size: 1.05rem; padding: 14px 28px;">
        👀 Révéler la personne que j'ai tirée au sort
      </button>
    `;

    $('reveal-target-btn').addEventListener('click', () => {
      state.isTargetRevealed = true;
      renderSecretDrawArea(s);
    });
    $('gift-reveal-trigger').addEventListener('click', () => {
      state.isTargetRevealed = true;
      renderSecretDrawArea(s);
    });
  } else {
    container.innerHTML = `
      <div style="font-size: 0.82rem; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); font-weight: 700;">
        🤫 Secret absolu — Vous êtes le Père Noël secret de :
      </div>
      <div class="revealed-target-card">
        <div class="revealed-avatar">${escapeHtml(target.avatar || '🎁')}</div>
        <div class="revealed-name">${escapeHtml(target.name)}</div>
        <div class="target-wishlist-box">
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--gold-light); text-transform: uppercase; margin-bottom: 4px;">
            📜 Sa liste de souhaits / Idées cadeaux :
          </div>
          <div style="font-size: 0.95rem; color: var(--snow); white-space: pre-wrap;">
            ${target.wishlist
              ? escapeHtml(target.wishlist)
              : '<em style="color: var(--snow-muted);">Cette personne n\'a pas encore renseigné d\'idées cadeaux.</em>'}
          </div>
        </div>
      </div>
      <button class="btn btn-outline btn-sm" id="hide-target-btn" style="margin-top: 16px;">
        🙈 Masquer le nom (protection anti-curieux)
      </button>
    `;

    $('hide-target-btn').addEventListener('click', () => {
      state.isTargetRevealed = false;
      renderSecretDrawArea(s);
    });
  }
}

function renderParticipantsList(s) {
  const list = $('detail-participants-list');
  list.innerHTML = '';

  s.participants.forEach(p => {
    const isMe = state.user && p.userId === state.user.id;
    const isOrganizer = p.userId === s.creatorId;
    const row = document.createElement('div');
    row.className = 'participant-row';
    row.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar">${escapeHtml(p.avatar || '🎅')}</div>
        <div>
          <div style="font-weight: 700; color: #fff;">
            ${escapeHtml(p.name)}
            ${isMe ? '<span style="font-size: 0.75rem; color: var(--gold); margin-left: 6px;">(Vous)</span>' : ''}
            ${isOrganizer ? '<span style="font-size: 0.72rem; background: rgba(246,196,83,0.2); color: var(--gold-light); padding: 2px 7px; border-radius: 99px; margin-left: 6px;">👑 Organisateur</span>' : ''}
          </div>
          <div style="font-size: 0.8rem; color: var(--snow-muted);">
            ${p.hasWishlist ? '📝 Liste de souhaits renseignée' : '⏳ Pas encore de liste de souhaits'}
          </div>
        </div>
      </div>
      <div style="font-size: 1.2rem;" title="Tirage protégé">🎁</div>
    `;
    list.appendChild(row);
  });
}

function renderExclusionsArea(s) {
  const card = $('exclusions-card');
  if (!s.isCreator || s.status === 'drawn' || s.participants.length < 3) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const fromSelect = $('excl-from');
  const toSelect = $('excl-to');
  const optionsHtml = s.participants
    .map(p => `<option value="${escapeHtml(p.userId)}">${escapeHtml(p.name)}</option>`)
    .join('');

  fromSelect.innerHTML = optionsHtml;
  toSelect.innerHTML = optionsHtml;
  if (s.participants.length > 1) {
    toSelect.selectedIndex = 1;
  }

  const exclList = $('exclusions-list');
  exclList.innerHTML = '';
  const nameMap = new Map(s.participants.map(p => [p.userId, p.name]));

  (s.exclusions || []).forEach((ex, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:8px;font-size:0.85rem;';
    item.innerHTML = `
      <span>🚫 <strong>${escapeHtml(nameMap.get(ex.from) || '?')}</strong> ne peut pas tirer <strong>${escapeHtml(nameMap.get(ex.to) || '?')}</strong></span>
      <button type="button" class="btn btn-outline btn-sm" data-remove-idx="${idx}" style="padding: 3px 8px; font-size: 0.75rem;">✕</button>
    `;
    item.querySelector('button').addEventListener('click', async () => {
      try {
        const res = await apiFetch(`/api/sessions/${s.id}/exclusions`, {
          method: 'POST',
          body: JSON.stringify({ removeIndex: idx })
        });
        state.currentSession = res.session;
        renderSessionDetail();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    exclList.appendChild(item);
  });
}

async function handleTriggerDraw() {
  const s = state.currentSession;
  if (!s) return;

  try {
    const data = await apiFetch(`/api/sessions/${s.id}/draw`, {
      method: 'POST'
    });
    state.currentSession = data.session;
    const idx = state.sessions.findIndex(item => item.id === s.id);
    if (idx !== -1) state.sessions[idx] = data.session;
    state.isTargetRevealed = false;
    showToast('🎉 Le tirage au sort Secret Santa a été effectué avec succès !');
    renderSessionDetail();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ==================== ÉVÉNEMENTS & FORMULAIRES ====================
function initEvents() {
  // Onglets Inscription / Connexion
  $('tab-register').addEventListener('click', () => {
    $('tab-register').classList.add('active');
    $('tab-login').classList.remove('active');
    $('register-form').classList.remove('hidden');
    $('login-form').classList.add('hidden');
  });

  $('tab-login').addEventListener('click', () => {
    $('tab-login').classList.add('active');
    $('tab-register').classList.remove('active');
    $('login-form').classList.remove('hidden');
    $('register-form').classList.add('hidden');
  });

  // Choix d'avatar
  document.querySelectorAll('#avatar-picker .avatar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#avatar-picker .avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedAvatar = btn.dataset.avatar;
    });
  });

  // Choix de l'action initiale lors de la création du compte (Rejoindre / Créer / Plus tard)
  document.querySelectorAll('#initial-action-cards .choice-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#initial-action-cards .choice-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.initialAction = card.dataset.action;

      $('reg-subform-join').classList.toggle('hidden', state.initialAction !== 'join');
      $('reg-subform-create').classList.toggle('hidden', state.initialAction !== 'create');
    });
  });

  // Soumission du formulaire d'inscription
  $('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: $('reg-name').value.trim(),
      username: $('reg-username').value.trim(),
      password: $('reg-password').value,
      avatar: state.selectedAvatar,
      initialAction: state.initialAction
    };

    if (state.initialAction === 'join') {
      payload.inviteCode = $('reg-invite-code').value.trim().toUpperCase();
      payload.wishlist = $('reg-join-wishlist').value.trim();
    } else if (state.initialAction === 'create') {
      payload.sessionName = $('reg-session-name').value.trim();
      payload.sessionBudget = $('reg-session-budget').value.trim();
      payload.sessionDate = $('reg-session-date').value;
      payload.wishlist = $('reg-create-wishlist').value.trim();
    }

    try {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.token = data.token;
      localStorage.setItem('secret_santa_token', data.token);
      showToast(`Bienvenue ${data.user.name} ! Votre compte de Noël est prêt.`);
      await loadProfileAndSessions(data.activeSessionId);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Soumission du formulaire de connexion
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('login-username').value.trim();
    const password = $('login-password').value;

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.token = data.token;
      localStorage.setItem('secret_santa_token', data.token);
      showToast(`Bon retour parmi nous, ${data.user.name} !`);
      await loadProfileAndSessions();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Déconnexion
  $('logout-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    localStorage.removeItem('secret_santa_token');
    state.token = null;
    state.user = null;
    state.sessions = [];
    state.currentSession = null;
    switchView('auth');
    showToast('Vous êtes déconnecté. À très vite !');
  });

  // Navigation
  $('nav-brand').addEventListener('click', () => {
    if (state.token) loadProfileAndSessions();
  });
  $('nav-dashboard-btn').addEventListener('click', () => {
    if (state.token) loadProfileAndSessions();
  });
  $('back-to-dashboard-btn').addEventListener('click', () => {
    loadProfileAndSessions();
  });
  $('refresh-sessions-btn').addEventListener('click', () => {
    loadProfileAndSessions();
    showToast('Sessions actualisées !');
  });

  // Copier le code d'invitation
  $('copy-code-btn').addEventListener('click', async () => {
    if (!state.currentSession) return;
    try {
      await navigator.clipboard.writeText(state.currentSession.code);
      showToast(`Code "${state.currentSession.code}" copié dans le presse-papiers !`);
    } catch (_) {
      showToast(`Code de la session : ${state.currentSession.code}`);
    }
  });

  // Enregistrer sa liste de souhaits
  $('wishlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentSession) return;
    try {
      const wishlist = $('my-wishlist-input').value.trim();
      const data = await apiFetch(`/api/sessions/${state.currentSession.id}/wishlist`, {
        method: 'POST',
        body: JSON.stringify({ wishlist })
      });
      state.currentSession = data.session;
      showToast('Votre liste de souhaits a bien été enregistrée !');
      renderSessionDetail();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Ajouter une exclusion
  $('exclusion-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentSession) return;
    const from = $('excl-from').value;
    const to = $('excl-to').value;
    const bidirectional = $('excl-bidirectional').checked;
    if (from === to) {
      return showToast('Choisissez deux participants différents.', true);
    }
    try {
      const data = await apiFetch(`/api/sessions/${state.currentSession.id}/exclusions`, {
        method: 'POST',
        body: JSON.stringify({ from, to, bidirectional })
      });
      state.currentSession = data.session;
      showToast('Exclusion ajoutée !');
      renderSessionDetail();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Modales Créer / Rejoindre depuis le tableau de bord
  $('open-create-modal-btn').addEventListener('click', () => {
    $('create-session-modal').classList.remove('hidden');
  });
  $('close-create-modal').addEventListener('click', () => {
    $('create-session-modal').classList.add('hidden');
  });

  $('open-join-modal-btn').addEventListener('click', () => {
    $('join-session-modal').classList.remove('hidden');
  });
  $('close-join-modal').addEventListener('click', () => {
    $('join-session-modal').classList.add('hidden');
  });

  $('create-session-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: $('modal-session-name').value.trim(),
          budget: $('modal-session-budget').value.trim(),
          eventDate: $('modal-session-date').value,
          description: $('modal-session-desc').value.trim(),
          wishlist: $('modal-session-wishlist').value.trim()
        })
      });
      $('create-session-modal').classList.add('hidden');
      $('create-session-form').reset();
      showToast(`Session "${data.session.name}" créée ! Code : ${data.session.code}`);
      await loadProfileAndSessions(data.session.id);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('join-session-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/api/sessions/join', {
        method: 'POST',
        body: JSON.stringify({
          code: $('modal-join-code').value.trim().toUpperCase(),
          wishlist: $('modal-join-wishlist').value.trim()
        })
      });
      $('join-session-modal').classList.add('hidden');
      $('join-session-form').reset();
      showToast(
        data.alreadyMember
          ? `Vous êtes déjà membre de "${data.session.name}" !`
          : `Vous avez rejoint la session "${data.session.name}" !`
      );
      await loadProfileAndSessions(data.session.id);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

// ==================== ANIMATION DES FLOCONS DE NEIGE ====================
function initSnowfall() {
  const canvas = $('snow-canvas');
  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const flakes = Array.from({ length: 75 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 3.2 + 1,
    speedY: Math.random() * 0.9 + 0.35,
    speedX: (Math.random() - 0.5) * 0.5,
    opacity: Math.random() * 0.55 + 0.25
  }));

  $('toggle-snow-btn').addEventListener('click', () => {
    state.snowEnabled = !state.snowEnabled;
    canvas.style.display = state.snowEnabled ? 'block' : 'none';
  });

  function draw() {
    if (state.snowEnabled) {
      ctx.clearRect(0, 0, width, height);
      for (const f of flakes) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${f.opacity})`;
        ctx.fill();

        f.y += f.speedY;
        f.x += f.speedX;

        if (f.y > height) {
          f.y = -5;
          f.x = Math.random() * width;
        }
        if (f.x > width) f.x = 0;
        if (f.x < 0) f.x = width;
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', () => {
  initSnowfall();
  initEvents();
  loadProfileAndSessions();
});

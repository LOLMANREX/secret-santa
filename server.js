const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [],
      tokens: {},
      sessions: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], tokens: {}, sessions: [] };
  }
}

function saveDB(db) {
  const tmpFile = DB_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = (stored || '').split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function generateInviteCode(existingSessions) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars[crypto.randomInt(0, chars.length)];
    }
    code = `NOEL-${suffix}`;
  } while (existingSessions.some(s => s.code === code));
  return code;
}

// Algorithme de tirage au sort Secret Santa garantissant :
// 1. Personne ne se tire soi-même (dérangement complet)
// 2. Respect des exclusions éventuelles
// 3. Mélange aléatoire uniforme (Fisher-Yates)
function computeSecretSantaAssignments(participantIds, exclusions = []) {
  const n = participantIds.length;
  if (n < 2) {
    throw new Error('Il faut au moins 2 participants pour lancer le tirage au sort.');
  }

  const exclusionSet = new Set(exclusions.map(e => `${e.from}:${e.to}`));

  // Essayer d'abord de construire un cycle Hamiltonien aléatoire respectant les exclusions
  for (let attempt = 0; attempt < 500; attempt++) {
    const shuffled = [...participantIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let valid = true;
    const assignments = {};
    for (let i = 0; i < n; i++) {
      const giver = shuffled[i];
      const receiver = shuffled[(i + 1) % n];
      if (giver === receiver || exclusionSet.has(`${giver}:${receiver}`)) {
        valid = false;
        break;
      }
      assignments[giver] = receiver;
    }

    if (valid) {
      return assignments;
    }
  }

  // Si un cycle unique n'est pas trouvé avec les exclusions, chercher n'importe quel dérangement valide par backtracking
  const receivers = [...participantIds];
  for (let i = receivers.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [receivers[i], receivers[j]] = [receivers[j], receivers[i]];
  }

  const used = new Array(n).fill(false);
  const result = {};

  function backtrack(idx) {
    if (idx === n) return true;
    const giver = participantIds[idx];
    for (let i = 0; i < n; i++) {
      const receiver = receivers[i];
      if (!used[i] && giver !== receiver && !exclusionSet.has(`${giver}:${receiver}`)) {
        used[i] = true;
        result[giver] = receiver;
        if (backtrack(idx + 1)) return true;
        used[i] = false;
        delete result[giver];
      }
    }
    return false;
  }

  if (backtrack(0)) {
    return result;
  }

  throw new Error('Impossible de réaliser un tirage respectant toutes les exclusions. Réduisez les exclusions ou ajoutez des participants.');
}

// Formate une session pour un utilisateur donné SANS JAMAIS exposer les tirages des autres !
function sanitizeSessionForUser(session, userId, db) {
  const userMap = new Map(db.users.map(u => [u.id, u]));

  const participants = session.participants.map(p => {
    const u = userMap.get(p.userId);
    return {
      userId: p.userId,
      name: u ? u.name : 'Lutins Mystère',
      avatar: u ? u.avatar : '🦌',
      joinedAt: p.joinedAt,
      hasWishlist: Boolean(p.wishlist && p.wishlist.trim().length > 0),
      // La wishlist d'un participant n'est visible que par lui-même OU par son Père Noël attitré !
      wishlist: (p.userId === userId) ? (p.wishlist || '') : undefined
    };
  });

  let myAssignment = null;
  if (session.status === 'drawn' && session.assignments && session.assignments[userId]) {
    const targetId = session.assignments[userId];
    const targetUser = userMap.get(targetId);
    const targetParticipant = session.participants.find(p => p.userId === targetId);
    if (targetUser) {
      myAssignment = {
        userId: targetUser.id,
        name: targetUser.name,
        avatar: targetUser.avatar || '🎁',
        wishlist: targetParticipant ? (targetParticipant.wishlist || '') : ''
      };
    }
  }

  const myParticipant = session.participants.find(p => p.userId === userId);

  return {
    id: session.id,
    name: session.name,
    code: session.code,
    budget: session.budget,
    eventDate: session.eventDate,
    description: session.description,
    creatorId: session.creatorId,
    isCreator: session.creatorId === userId,
    status: session.status, // 'open' | 'drawn'
    createdAt: session.createdAt,
    drawnAt: session.drawnAt || null,
    participantCount: participants.length,
    participants,
    exclusions: session.exclusions || [],
    myWishlist: myParticipant ? (myParticipant.wishlist || '') : '',
    myAssignment // Uniquement la personne que CET utilisateur a tirée !
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload trop volumineux'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function getAuthenticatedUser(req, db) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token || !db.tokens[token]) return null;
  const userId = db.tokens[token];
  return db.users.find(u => u.id === userId) || null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // --- API ROUTES ---
    if (pathname.startsWith('/api/')) {
      const db = loadDB();

      // 1. Inscription (avec choix optionnel : créer une session ou rejoindre une session)
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await parseBody(req);
        const name = (body.name || '').trim();
        const username = (body.username || '').trim().toLowerCase();
        const password = body.password || '';
        const avatar = body.avatar || '🎅';
        const initialAction = body.initialAction || 'none'; // 'create' | 'join' | 'none'

        if (!name || !username || !password) {
          return sendJSON(res, 400, { error: 'Veuillez remplir votre prénom/nom, votre identifiant et votre mot de passe.' });
        }
        if (password.length < 4) {
          return sendJSON(res, 400, { error: 'Le mot de passe doit contenir au moins 4 caractères.' });
        }
        if (db.users.some(u => u.username === username)) {
          return sendJSON(res, 409, { error: 'Cet identifiant ou email est déjà utilisé. Connectez-vous ou choisissez-en un autre.' });
        }

        // Vérifier l'action initiale AVANT de créer l'utilisateur pour éviter un compte orphelin en cas d'erreur de code
        let targetSessionToJoin = null;
        if (initialAction === 'join') {
          const inviteCode = (body.inviteCode || '').trim().toUpperCase();
          if (!inviteCode) {
            return sendJSON(res, 400, { error: 'Veuillez entrer le code de la session que vous souhaitez rejoindre.' });
          }
          targetSessionToJoin = db.sessions.find(s => s.code.toUpperCase() === inviteCode);
          if (!targetSessionToJoin) {
            return sendJSON(res, 404, { error: `Aucune session trouvée avec le code "${inviteCode}". Vérifiez le code auprès de l'organisateur.` });
          }
          if (targetSessionToJoin.status === 'drawn') {
            return sendJSON(res, 400, { error: 'Le tirage au sort de cette session a déjà été effectué, il n\'est plus possible de la rejoindre.' });
          }
        } else if (initialAction === 'create') {
          const sessionName = (body.sessionName || '').trim();
          if (!sessionName) {
            return sendJSON(res, 400, { error: 'Veuillez donner un nom à votre nouvelle session Secret Santa.' });
          }
        }

        const newUser = {
          id: 'usr_' + crypto.randomBytes(8).toString('hex'),
          name,
          username,
          avatar,
          passwordHash: hashPassword(password),
          createdAt: new Date().toISOString()
        };
        db.users.push(newUser);

        let activeSessionId = null;

        if (initialAction === 'create') {
          const sessionName = (body.sessionName || '').trim();
          const budget = (body.sessionBudget || '25 €').trim();
          const eventDate = (body.sessionDate || '2026-12-25').trim();
          const description = (body.sessionDescription || '').trim();
          const wishlist = (body.wishlist || '').trim();

          const newSession = {
            id: 'ses_' + crypto.randomBytes(8).toString('hex'),
            name: sessionName,
            code: generateInviteCode(db.sessions),
            budget: budget || 'Libre',
            eventDate: eventDate || '2026-12-25',
            description,
            creatorId: newUser.id,
            status: 'open',
            createdAt: new Date().toISOString(),
            participants: [
              {
                userId: newUser.id,
                wishlist,
                joinedAt: new Date().toISOString()
              }
            ],
            exclusions: [],
            assignments: {}
          };
          db.sessions.push(newSession);
          activeSessionId = newSession.id;
        } else if (initialAction === 'join' && targetSessionToJoin) {
          const wishlist = (body.wishlist || '').trim();
          targetSessionToJoin.participants.push({
            userId: newUser.id,
            wishlist,
            joinedAt: new Date().toISOString()
          });
          activeSessionId = targetSessionToJoin.id;
        }

        const token = crypto.randomBytes(24).toString('hex');
        db.tokens[token] = newUser.id;
        saveDB(db);

        return sendJSON(res, 201, {
          token,
          user: { id: newUser.id, name: newUser.name, username: newUser.username, avatar: newUser.avatar },
          activeSessionId
        });
      }

      // 2. Connexion
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const username = (body.username || '').trim().toLowerCase();
        const password = body.password || '';

        const user = db.users.find(u => u.username === username);
        if (!user || !verifyPassword(password, user.passwordHash)) {
          return sendJSON(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
        }

        const token = crypto.randomBytes(24).toString('hex');
        db.tokens[token] = user.id;
        saveDB(db);

        return sendJSON(res, 200, {
          token,
          user: { id: user.id, name: user.name, username: user.username, avatar: user.avatar }
        });
      }

      // 3. Déconnexion
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        if (token && db.tokens[token]) {
          delete db.tokens[token];
          saveDB(db);
        }
        return sendJSON(res, 200, { ok: true });
      }

      // Toutes les routes suivantes nécessitent d'être connecté
      const currentUser = getAuthenticatedUser(req, db);
      if (!currentUser) {
        return sendJSON(res, 401, { error: 'Non authentifié. Veuillez vous connecter.' });
      }

      // 4. Profil + Liste des sessions de l'utilisateur
      if (pathname === '/api/me' && req.method === 'GET') {
        const mySessions = db.sessions
          .filter(s => s.participants.some(p => p.userId === currentUser.id))
          .map(s => sanitizeSessionForUser(s, currentUser.id, db));

        return sendJSON(res, 200, {
          user: {
            id: currentUser.id,
            name: currentUser.name,
            username: currentUser.username,
            avatar: currentUser.avatar
          },
          sessions: mySessions
        });
      }

      // 5. Créer une nouvelle session
      if (pathname === '/api/sessions' && req.method === 'POST') {
        const body = await parseBody(req);
        const name = (body.name || '').trim();
        const budget = (body.budget || '25 €').trim();
        const eventDate = (body.eventDate || '2026-12-25').trim();
        const description = (body.description || '').trim();
        const wishlist = (body.wishlist || '').trim();

        if (!name) {
          return sendJSON(res, 400, { error: 'Veuillez indiquer un nom pour la session.' });
        }

        const newSession = {
          id: 'ses_' + crypto.randomBytes(8).toString('hex'),
          name,
          code: generateInviteCode(db.sessions),
          budget: budget || 'Libre',
          eventDate: eventDate || '2026-12-25',
          description,
          creatorId: currentUser.id,
          status: 'open',
          createdAt: new Date().toISOString(),
          participants: [
            {
              userId: currentUser.id,
              wishlist,
              joinedAt: new Date().toISOString()
            }
          ],
          exclusions: [],
          assignments: {}
        };

        db.sessions.push(newSession);
        saveDB(db);

        return sendJSON(res, 201, {
          session: sanitizeSessionForUser(newSession, currentUser.id, db)
        });
      }

      // 6. Rejoindre une session existante via son code
      if (pathname === '/api/sessions/join' && req.method === 'POST') {
        const body = await parseBody(req);
        const code = (body.code || '').trim().toUpperCase();
        const wishlist = (body.wishlist || '').trim();

        if (!code) {
          return sendJSON(res, 400, { error: 'Veuillez saisir un code de session (ex: NOEL-ABCD).' });
        }

        const session = db.sessions.find(s => s.code.toUpperCase() === code);
        if (!session) {
          return sendJSON(res, 404, { error: `Aucune session trouvée avec le code "${code}".` });
        }

        const alreadyIn = session.participants.find(p => p.userId === currentUser.id);
        if (alreadyIn) {
          return sendJSON(res, 200, {
            alreadyMember: true,
            session: sanitizeSessionForUser(session, currentUser.id, db)
          });
        }

        if (session.status === 'drawn') {
          return sendJSON(res, 400, { error: 'Le tirage au sort de cette session a déjà eu lieu ! Impossible de la rejoindre.' });
        }

        session.participants.push({
          userId: currentUser.id,
          wishlist,
          joinedAt: new Date().toISOString()
        });

        saveDB(db);
        return sendJSON(res, 200, {
          session: sanitizeSessionForUser(session, currentUser.id, db)
        });
      }

      // Routes spécifiques à une session : /api/sessions/:id/...
      const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(\/([a-z-]+))?$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const subAction = sessionMatch[3] || '';
        const session = db.sessions.find(s => s.id === sessionId);

        if (!session) {
          return sendJSON(res, 404, { error: 'Session introuvable.' });
        }

        const isParticipant = session.participants.some(p => p.userId === currentUser.id);
        if (!isParticipant) {
          return sendJSON(res, 403, { error: 'Vous ne faites pas partie de cette session.' });
        }

        // GET /api/sessions/:id
        if (!subAction && req.method === 'GET') {
          return sendJSON(res, 200, {
            session: sanitizeSessionForUser(session, currentUser.id, db)
          });
        }

        // POST /api/sessions/:id/wishlist -> Mettre à jour sa propre liste de souhaits
        if (subAction === 'wishlist' && req.method === 'POST') {
          const body = await parseBody(req);
          const wishlist = (body.wishlist || '').trim();
          const participant = session.participants.find(p => p.userId === currentUser.id);
          if (participant) {
            participant.wishlist = wishlist;
            saveDB(db);
          }
          return sendJSON(res, 200, {
            session: sanitizeSessionForUser(session, currentUser.id, db)
          });
        }

        // POST /api/sessions/:id/exclusions -> Ajouter/supprimer une exclusion (créateur uniquement, avant tirage)
        if (subAction === 'exclusions' && req.method === 'POST') {
          if (session.creatorId !== currentUser.id) {
            return sendJSON(res, 403, { error: 'Seul l\'organisateur de la session peut gérer les exclusions.' });
          }
          if (session.status === 'drawn') {
            return sendJSON(res, 400, { error: 'Le tirage est déjà effectué.' });
          }
          const body = await parseBody(req);
          const { from, to, bidirectional, removeIndex } = body;

          if (!session.exclusions) session.exclusions = [];

          if (typeof removeIndex === 'number') {
            session.exclusions.splice(removeIndex, 1);
          } else if (from && to && from !== to) {
            if (!session.exclusions.some(e => e.from === from && e.to === to)) {
              session.exclusions.push({ from, to });
            }
            if (bidirectional && !session.exclusions.some(e => e.from === to && e.to === from)) {
              session.exclusions.push({ from: to, to: from });
            }
          }

          saveDB(db);
          return sendJSON(res, 200, {
            session: sanitizeSessionForUser(session, currentUser.id, db)
          });
        }

        // POST /api/sessions/:id/draw -> Lancer le tirage au sort secret !
        if (subAction === 'draw' && req.method === 'POST') {
          if (session.creatorId !== currentUser.id) {
            return sendJSON(res, 403, { error: 'Seul le créateur de la session peut lancer le tirage au sort.' });
          }
          if (session.status === 'drawn') {
            return sendJSON(res, 400, { error: 'Le tirage au sort a déjà été effectué pour cette session.' });
          }
          if (session.participants.length < 2) {
            return sendJSON(res, 400, { error: 'Il faut au moins 2 participants dans la session pour lancer le tirage au sort.' });
          }

          const participantIds = session.participants.map(p => p.userId);
          try {
            const assignments = computeSecretSantaAssignments(participantIds, session.exclusions || []);
            session.assignments = assignments;
            session.status = 'drawn';
            session.drawnAt = new Date().toISOString();
            saveDB(db);

            return sendJSON(res, 200, {
              session: sanitizeSessionForUser(session, currentUser.id, db)
            });
          } catch (err) {
            return sendJSON(res, 400, { error: err.message });
          }
        }

        // POST /api/sessions/:id/leave -> Quitter une session (si non tirée et pas créateur)
        if (subAction === 'leave' && req.method === 'POST') {
          if (session.status === 'drawn') {
            return sendJSON(res, 400, { error: 'Impossible de quitter la session une fois le tirage effectué.' });
          }
          if (session.creatorId === currentUser.id) {
            return sendJSON(res, 400, { error: 'L\'organisateur ne peut pas quitter sa propre session.' });
          }
          session.participants = session.participants.filter(p => p.userId !== currentUser.id);
          session.exclusions = (session.exclusions || []).filter(e => e.from !== currentUser.id && e.to !== currentUser.id);
          saveDB(db);
          return sendJSON(res, 200, { ok: true });
        }
      }

      return sendJSON(res, 404, { error: 'Route API introuvable.' });
    }

    // --- FICHIERS STATIQUES ---
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const resolvedPath = path.normalize(path.join(PUBLIC_DIR, filePath));
    if (!resolvedPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Accès refusé');
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(resolvedPath).pipe(res);
    } else {
      // Fallback SPA vers index.html
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexFile).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    }
  } catch (err) {
    console.error('Server error:', err);
    sendJSON(res, 500, { error: err.message || 'Erreur interne du serveur' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎄 Serveur Secret Santa de Noël démarré sur http://localhost:${PORT}`);
});

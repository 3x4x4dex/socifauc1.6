const TOKEN = 'SFC';
const ENERGY_POINT_COST = 3;
const ADMIN_EMAIL = '3x4x4dex@gmail.com';
let rewardSettings = {
  post_reward: 0.5,
  like_reward: 0.01,
  comment_reward: 0.005,
  repost_reward: 0.015,
  story_reward: 0.1,
  mission_post_reward: 0.5,
  mission_video_reward: 0.8,
  mission_engagement_reward: 0.2,
  mission_engagement_goal: 5,
  ad_cpm_sfc: 10
};
const supabaseClient = window.supabase && window.SOCFAUC_SUPABASE_URL && window.SOCFAUC_SUPABASE_ANON_KEY
  ? window.supabase.createClient(window.SOCFAUC_SUPABASE_URL, window.SOCFAUC_SUPABASE_ANON_KEY)
  : null;
let walletRealtimeChannel = null;
let feedCounterRealtimeChannel = null;
const storedCapacity = Number(localStorage.getItem('socifaucEnergyCapacity') || 100);
const state = { balance: 38.42, daily: 2.84, energy: Math.min(Number(localStorage.getItem('socifaucEnergy') || 100), storedCapacity), energyCapacity: Math.min(1000, Math.max(100, storedCapacity)) };
let energyUpdatedAt = Number(localStorage.getItem('socifaucEnergyUpdatedAt') || Date.now());
const toast = document.getElementById('toast');
const sidebarBalance = document.getElementById('sidebarBalance');
const dailyEarn = document.getElementById('dailyEarn');
const profileModal = document.getElementById('profileModal');
const profilePhoto = document.getElementById('profilePhoto');
const profilePage = document.getElementById('profilePage');
const walletPage = document.getElementById('walletPage');
const explorePage = document.getElementById('explorePage');
const advertisingPage = document.getElementById('advertisingPage');
const messagesPage = document.getElementById('messagesPage');
const notificationsPage = document.getElementById('notificationsPage');
const tipModal = document.getElementById('tipModal');
const storyModal = document.getElementById('storyModal');
const storyFile = document.getElementById('storyFile');
const storyUploadPreview = document.getElementById('storyUploadPreview');
const withdrawModal = document.getElementById('withdrawModal');
const energyModal = document.getElementById('energyModal');
const adminPage = document.getElementById('adminPage');
const adminNavItem = document.getElementById('adminNavItem');
let pendingStoryImage = '';
let activeStories = [];
let storiesByAuthor = new Map();
let storyRealtimeChannel = null;
let storyExpiryRefresh = null;
let storyViewerTimer = null;
let storyViewerItems = [];
let storyViewerIndex = 0;
const communitySearch = document.getElementById('communitySearch');
const searchShell = communitySearch.closest('.search');
const searchResult = document.getElementById('searchResult');
const clearSearch = document.getElementById('clearSearch');
const contentWrap = document.querySelector('.content-wrap');
let toastTimer;

async function persistWallet() {
  if (!supabaseClient || !currentUser) return;
  const { error } = await supabaseClient.from('wallets').upsert({
    user_id: currentUser.id,
    sfc_balance: state.balance,
    energy: state.energy,
    energy_capacity: state.energyCapacity,
    energy_updated_at: new Date(energyUpdatedAt).toISOString(),
    updated_at: new Date().toISOString()
  });
  if (error) console.error('Supabase wallet:', error);
}

async function loadUserData(user) {
  if (!supabaseClient || !user) return;
  let [{ data: profile }, { data: wallet }] = await Promise.all([
    supabaseClient.from('profiles').select('display_name,username,bio,age,avatar_url,followers_count,following_count,likes_received').eq('id', user.id).maybeSingle(),
    supabaseClient.from('wallets').select('sfc_balance,energy,energy_capacity,energy_updated_at').eq('user_id', user.id).maybeSingle()
  ]);
  const fallbackName = user.user_metadata?.display_name || user.email.split('@')[0];
  const fallbackUsername = user.user_metadata?.username || user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'usuario';
  if (!profile) {
    const result = await supabaseClient.from('profiles').upsert({ id: user.id, username: fallbackUsername, display_name: fallbackName }, { onConflict: 'id' }).select('display_name,username,bio,age,avatar_url,followers_count,following_count,likes_received').single();
    if (result.error) console.error('Supabase profile create:', result.error);
    profile = result.data;
  }
  if (!wallet) {
    const result = await supabaseClient.from('wallets').upsert({ user_id: user.id, sfc_balance: 0, energy: 100, energy_capacity: 100 }, { onConflict: 'user_id' }).select('sfc_balance,energy,energy_capacity,energy_updated_at').single();
    if (result.error) console.error('Supabase wallet create:', result.error);
    wallet = result.data;
  }
  if (profile) {
    currentProfile = profile;
    document.querySelector('.profile-mini strong').textContent = profile.display_name;
    document.querySelector('.profile-mini small').textContent = `@${profile.username}`;
    document.getElementById('profileName').value = profile.display_name || '';
    document.getElementById('profileHandle').value = profile.username || '';
    document.getElementById('profileAge').value = profile.age || '';
    profileBio.value = profile.bio || '';
    bioCount.textContent = `${profileBio.value.length}/160`;
    applyCurrentProfileIdentity();
  }
  if (wallet) {
    state.balance = Number(wallet.sfc_balance);
    state.energy = Number(wallet.energy);
    state.energyCapacity = Number(wallet.energy_capacity);
    energyUpdatedAt = new Date(wallet.energy_updated_at).getTime();
    updateBalanceDisplay();
    updateEnergyDisplay();
  }
}

function applyAvatar(element, name, imageUrl) {
  if (!element) return;
  const initials = (name || 'Usuário').trim().slice(0, 2).toUpperCase() || 'U';
  element.textContent = imageUrl ? '' : initials;
  element.style.backgroundImage = imageUrl ? `url("${imageUrl.replace(/["\\]/g, '')}")` : '';
  if (imageUrl) {
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
  } else {
    element.style.removeProperty('background-size');
    element.style.removeProperty('background-position');
  }
}

function applyCurrentProfileIdentity() {
  const name = currentProfile?.display_name || currentUser?.user_metadata?.display_name || currentUser?.email?.split('@')[0] || 'Usuário';
  const handle = currentProfile?.username || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'usuario';
  const photo = currentProfile?.avatar_url || localStorage.getItem('socfaucProfilePhoto') || '';
  document.querySelectorAll('.profile-mini .avatar, .composer-head .avatar, .top-actions > .avatar, #createStoryButton .avatar').forEach((element) => applyAvatar(element, name, photo));
  applyAvatar(profilePhoto, name, photo);
  applyAvatar(document.getElementById('profilePagePhoto'), name, photo);
  document.querySelector('.profile-mini strong').textContent = name;
  document.querySelector('.profile-mini small').textContent = `@${handle}`;
}

function applyTokenLabel() {
  const scopes = document.querySelectorAll('.balance-card, #feedPosts, .earn-card, .leaderboard, .engagement-rewards, #advertisingPage, #walletPage, #profilePage, #toast');
  scopes.forEach((scope) => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => { node.nodeValue = node.nodeValue.replaceAll('SOCFAUC', TOKEN); });
  });
}

applyTokenLabel();
document.querySelector('.profile-dialog-head small').textContent = 'IDENTIDADE socifauc';

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function applyRewardSettings() {
  const inputs = {
    post_reward: 'rewardPost',
    like_reward: 'rewardLike',
    comment_reward: 'rewardComment',
    repost_reward: 'rewardRepost',
    story_reward: 'rewardStory',
    mission_post_reward: 'missionPostReward',
    mission_video_reward: 'missionVideoReward',
    mission_engagement_reward: 'missionEngagementReward',
    mission_engagement_goal: 'missionEngagementGoal',
    ad_cpm_sfc: 'adCpmSfc'
  };
  Object.entries(inputs).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (input) input.value = String(rewardSettings[key]);
  });
  document.querySelectorAll('[data-engagement-reward]').forEach((element) => {
    const amount = Number(rewardSettings[element.dataset.engagementReward] || 0).toFixed(6);
    element.textContent = amount;
  });
  const cpmLabel = document.getElementById('adsCurrentCpm');
  if (cpmLabel) cpmLabel.textContent = `${Number(rewardSettings.ad_cpm_sfc || 10).toFixed(6)} SFC`;
  updateAdBudgetPreview();
}

async function loadRewardSettings() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.from('reward_settings').select('*').eq('id', true).maybeSingle();
  if (error) {
    console.warn('reward settings:', error.message);
    return;
  }
  if (!data) return;
  rewardSettings = { ...rewardSettings, ...data };
  applyRewardSettings();
}

function startRewardSettingsRealtime() {
  if (!supabaseClient || window.rewardSettingsChannel) return;
  window.rewardSettingsChannel = supabaseClient.channel('reward-settings-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reward_settings', filter: 'id=eq.true' }, (payload) => {
      rewardSettings = { ...rewardSettings, ...payload.new };
      applyRewardSettings();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime de recompensas indisponível; os valores serão atualizados ao recarregar.');
    });
}

const authModal = document.getElementById('authModal');
const authDialog = authModal.querySelector('.auth-dialog');
const authForm = document.getElementById('authForm');
const authAction = document.getElementById('authAction');
let authMode = 'login';
let currentUser = null;
let currentProfile = null;
let activeMessageRecipientId = null;
let messageProfilesById = new Map();
let messagesRealtimeChannel = null;
let messageFollowerIds = new Set();
let notificationsRealtimeChannel = null;
let notificationFilter = 'all';
let notificationProfilesById = new Map();
let weeklyLeaderboardEntries = [];
let weeklyLeaderboardExpanded = false;
let weeklyLeaderboardChannel = null;
let weeklyLeaderboardRefreshTimer = null;
let weeklyLeaderboardRequestId = 0;
let exploreRequestId = 0;
let exploreFollowIds = new Set();
let exploreFollowAvailable = true;
let exploreRealtimeChannel = null;
let adCampaignRequestId = 0;
let adImpressionObserver = null;

function openAuth(mode = 'login') {
  authMode = mode;
  authDialog.classList.toggle('signup', mode === 'signup');
  document.getElementById('authEyebrow').textContent = mode === 'signup' ? 'COMECE NO SOCIFAUC' : 'ENTRE NA COMUNIDADE';
  document.getElementById('authTitle').textContent = mode === 'signup' ? 'Crie sua conta' : 'Bem-vindo de volta';
  document.getElementById('authDescription').textContent = mode === 'signup' ? 'Cadastre-se para publicar, ganhar SFC e acompanhar sua carteira.' : 'Entre para publicar, ganhar SFC e acompanhar sua carteira.';
  document.getElementById('authSubmit').innerHTML = `${mode === 'signup' ? 'Criar conta' : 'Entrar'} <span>↗</span>`;
  document.getElementById('authSwitch').innerHTML = mode === 'signup' ? 'Já tem uma conta? <button type="button">Entrar</button>' : 'Ainda não tem conta? <button type="button">Criar conta</button>';
  document.getElementById('authSwitch').querySelector('button').addEventListener('click', () => openAuth(mode === 'login' ? 'signup' : 'login'));
  document.getElementById('authError').textContent = '';
  document.getElementById('resendConfirmation').classList.remove('visible');
  authModal.classList.add('open');
  document.body.classList.add('auth-open');
  authModal.setAttribute('aria-hidden', 'false');
  document.getElementById('authEmail').focus();
}

function closeAuth() {
  authModal.classList.remove('open');
  document.body.classList.remove('auth-open');
  authModal.setAttribute('aria-hidden', 'true');
  authForm.reset();
}

function authErrorMessage(error) {
  if (error.message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (error.message.toLowerCase().includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (error.message.toLowerCase().includes('rate limit') || error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (error.message.toLowerCase().includes('failed to fetch')) return 'Não foi possível conectar ao Supabase. Verifique a URL e a anon key.';
  if (error.message.includes('already registered')) return 'Este e-mail já possui uma conta.';
  if (error.message.includes('Password should be')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return 'Não foi possível concluir. Confira os dados e tente novamente.';
}

async function syncAuthSession(session) {
  currentUser = session?.user || null;
  authAction.textContent = currentUser ? 'Sair' : 'Entrar';
  authAction.classList.toggle('logged-in', Boolean(currentUser));
  const isAdmin = currentUser && (currentUser.email || '').toLowerCase() === ADMIN_EMAIL;
  adminNavItem.hidden = !isAdmin;
  if (!currentUser) {
    stopMessagesRealtime();
    stopNotificationsRealtime();
    stopWalletRealtime();
    stopFeedCounterRealtime();
    activeMessageRecipientId = null;
    if (messagesPage.classList.contains('visible') || advertisingPage.classList.contains('visible')) showFeed();
    if (notificationsPage.classList.contains('visible')) showFeed();
  }
  if (!isAdmin && adminPage && !adminPage.hidden) showFeed();
  if (currentUser) {
    const displayName = currentUser.user_metadata?.display_name || currentUser.email.split('@')[0];
    document.querySelector('.profile-mini strong').textContent = displayName;
    document.querySelector('.profile-mini small').textContent = `@${currentUser.user_metadata?.username || currentUser.email.split('@')[0]}`;
    await loadUserData(currentUser);
    if (contentWrap.style.display !== 'none') await loadRemoteFeed();
    trackDailyActive();
    startWalletRealtime();
    startFeedCounterRealtime();
    startNotificationsRealtime();
    updateNotificationBadge();
    if (explorePage.classList.contains('visible')) loadExploreData();
    if (isAdmin) document.getElementById('adminLoggedEmail').textContent = currentUser.email;
    if (messagesPage.classList.contains('visible')) {
      startMessagesRealtime();
      refreshMessagesPage();
    }
  }
}

function trackDailyActive() {
  if (!supabaseClient || !currentUser) return;
  const day = new Date().toISOString().slice(0, 10);
  supabaseClient.from('daily_active_users').upsert(
    { day, user_id: currentUser.id, last_seen_at: new Date().toISOString() },
    { onConflict: 'day,user_id' }
  ).then(({ error }) => { if (error) console.warn('daily_active_users:', error.message); });
}

function stopWalletRealtime() {
  if (!walletRealtimeChannel || !supabaseClient) return;
  const channel = walletRealtimeChannel;
  walletRealtimeChannel = null;
  supabaseClient.removeChannel(channel);
}

function stopFeedCounterRealtime() {
  if (!feedCounterRealtimeChannel || !supabaseClient) return;
  const channel = feedCounterRealtimeChannel;
  feedCounterRealtimeChannel = null;
  supabaseClient.removeChannel(channel);
}

function startFeedCounterRealtime() {
  if (!supabaseClient || !currentUser || feedCounterRealtimeChannel) return;
  feedCounterRealtimeChannel = supabaseClient.channel(`feed-counters-${currentUser.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
      const post = [...document.querySelectorAll('#feedPosts > .post')]
        .find((item) => item.dataset.postId === payload.new.id);
      if (!post) return;
      updatePostEngagementCount(post, 'like', Number(payload.new.likes_count || 0));
      updatePostEngagementCount(post, 'comment', Number(payload.new.comments_count || 0));
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime das contagens indisponível; os valores serão atualizados ao recarregar o feed.');
    });
}

function startWalletRealtime() {
  if (!supabaseClient || !currentUser || walletRealtimeChannel) return;
  walletRealtimeChannel = supabaseClient.channel(`wallet-balance-${currentUser.id}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'wallets',
      filter: `user_id=eq.${currentUser.id}`
    }, (payload) => {
      const previousEnergy = state.energy;
      state.balance = Number(payload.new.sfc_balance || 0);
      state.energy = Number(payload.new.energy || 0);
      state.energyCapacity = Number(payload.new.energy_capacity || state.energyCapacity);
      energyUpdatedAt = new Date(payload.new.energy_updated_at || Date.now()).getTime();
      updateBalanceDisplay();
      renderEnergyDisplay();
      if (state.energy >= state.energyCapacity && previousEnergy < state.energyCapacity - 0.5) {
        showToast('Pagamento confirmado: sua energia foi restaurada para 100%');
      }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime da carteira indisponível; saldo será atualizado na próxima consulta.');
    });
}

authAction.addEventListener('click', async () => {
  if (!supabaseClient) { showToast('Configure o Supabase para entrar'); return; }
  if (currentUser) {
    await supabaseClient.auth.signOut();
    showToast('Sessão encerrada');
    return;
  }
  openAuth();
});
document.getElementById('closeAuth').addEventListener('click', closeAuth);
authModal.addEventListener('click', (event) => { if (event.target === authModal) closeAuth(); });
document.getElementById('authReset').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  if (!email) { document.getElementById('authError').textContent = 'Informe seu e-mail para receber o link.'; return; }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  if (error) { document.getElementById('authError').textContent = authErrorMessage(error); return; }
  closeAuth();
  showToast('Link de recuperação enviado para seu e-mail');
});
document.getElementById('resendConfirmation').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const errorBox = document.getElementById('authError');
  const { error } = await supabaseClient.auth.resend({ type: 'signup', email });
  if (error) { errorBox.textContent = authErrorMessage(error); return; }
  document.getElementById('resendConfirmation').classList.remove('visible');
  errorBox.textContent = 'Novo e-mail de confirmação enviado.';
});
authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const displayName = document.getElementById('authName').value.trim() || email.split('@')[0];
  const errorBox = document.getElementById('authError');
  errorBox.textContent = '';
  const result = authMode === 'signup'
    ? await supabaseClient.auth.signUp({ email, password, options: { data: { display_name: displayName, username: displayName.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'usuario' } } })
    : await supabaseClient.auth.signInWithPassword({ email, password });
  if (result.error) {
    console.error('Supabase auth:', result.error);
    errorBox.textContent = authErrorMessage(result.error);
    document.getElementById('resendConfirmation').classList.toggle('visible', result.error.message.toLowerCase().includes('email not confirmed'));
    return;
  }
  if (authMode === 'signup' && !result.data.session) {
    errorBox.textContent = 'Conta criada. Confirme o link enviado para seu e-mail antes de entrar.';
    document.getElementById('resendConfirmation').classList.add('visible');
    return;
  }
  if (authMode === 'signup' && result.data.user) {
    const username = result.data.user.user_metadata?.username || email.split('@')[0];
    await supabaseClient.from('profiles').upsert({ id: result.data.user.id, username, display_name: displayName });
    await supabaseClient.from('wallets').upsert({ user_id: result.data.user.id, sfc_balance: 0, energy: 100, energy_capacity: 100 });
  }
  closeAuth();
  showToast(authMode === 'signup' ? 'Conta criada com sucesso' : 'Login realizado com sucesso');
});

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((_event, session) => syncAuthSession(session));
  supabaseClient.auth.getSession().then(({ data }) => syncAuthSession(data.session));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function runCommunitySearch() {
  const term = communitySearch.value.trim().toLowerCase();
  const posts = [...document.querySelectorAll('#feedPosts > .post')];
  let matches = 0;
  posts.forEach((post) => {
    const matchesTerm = !term || post.textContent.toLowerCase().includes(term);
    post.classList.toggle('search-hidden', !matchesTerm);
    if (matchesTerm) matches += 1;
  });
  searchShell.classList.toggle('has-query', Boolean(term));
  if (!term) {
    searchResult.classList.remove('visible');
    return;
  }
  searchResult.classList.add('visible');
  searchResult.innerHTML = matches ? `<strong>${matches}</strong> ${matches === 1 ? 'post encontrado' : 'posts encontrados'} para “${escapeHtml(term)}”` : '<span class="search-empty">Nenhum post encontrado. Tente outro termo.</span>';
}

communitySearch.addEventListener('input', runCommunitySearch);
clearSearch.addEventListener('click', () => { communitySearch.value = ''; runCommunitySearch(); communitySearch.focus(); });
communitySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { communitySearch.value = ''; runCommunitySearch(); }
});

function openStoryModal() {
  if (!supabaseClient) { showToast('Configure o Supabase para publicar status'); return; }
  if (!currentUser) { showToast('Entre na sua conta para publicar um status'); openAuth(); return; }
  storyModal.classList.add('open');
  storyModal.setAttribute('aria-hidden', 'false');
  document.getElementById('storyText').focus();
}

function closeStoryModal() {
  storyModal.classList.remove('open');
  storyModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('createStoryButton').addEventListener('click', openStoryModal);
document.getElementById('closeStory').addEventListener('click', closeStoryModal);
storyModal.addEventListener('click', (event) => { if (event.target === storyModal) closeStoryModal(); });

storyFile.addEventListener('change', () => {
  const [file] = storyFile.files;
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showToast('Use uma imagem PNG, JPG ou WEBP');
    storyFile.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('A foto do story precisa ter até 5 MB');
    storyFile.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    pendingStoryImage = reader.result;
    storyUploadPreview.textContent = '';
    storyUploadPreview.style.backgroundImage = `url(${pendingStoryImage})`;
    storyUploadPreview.classList.add('has-image');
  });
  reader.addEventListener('error', () => showToast('Não foi possível carregar essa imagem'));
  reader.readAsDataURL(file);
});

document.getElementById('publishStory').addEventListener('click', async () => {
  const text = document.getElementById('storyText').value.trim();
  if (!text && !pendingStoryImage) {
    showToast('Adicione um texto ou uma foto ao story');
    return;
  }
  if (!supabaseClient || !currentUser) { showToast('Entre na sua conta para publicar um status'); return; }
  const button = document.getElementById('publishStory');
  button.disabled = true;
  const { error } = await supabaseClient.from('stories').insert({
    author_id: currentUser.id,
    body: text,
    image_url: pendingStoryImage || null
  });
  button.disabled = false;
  if (error) {
    console.error('publish story:', error);
    showToast(`Não foi possível publicar: ${error.message}. Confira supabase-stories.sql.`);
    return;
  }
  resetStoryComposer();
  closeStoryModal();
  showToast(`Status publicado por 24 horas · +${Number(rewardSettings.story_reward).toFixed(6)} ${TOKEN}`);
  await loadUserData(currentUser);
  await loadStories();
});

function resetStoryComposer() {
  document.getElementById('storyText').value = '';
  storyFile.value = '';
  pendingStoryImage = '';
  storyUploadPreview.style.backgroundImage = '';
  storyUploadPreview.textContent = 'Adicione uma foto opcional';
  storyUploadPreview.classList.remove('has-image');
}

function renderStoryStrip() {
  const strip = document.querySelector('.stories');
  const addButton = document.getElementById('createStoryButton');
  strip.replaceChildren(addButton);
  if (!activeStories.length) {
    const empty = document.createElement('span');
    empty.className = 'stories-empty';
    empty.textContent = 'Nenhum status recente';
    strip.appendChild(empty);
    return;
  }

  const grouped = new Map();
  activeStories.forEach((story) => {
    if (!grouped.has(story.author_id)) grouped.set(story.author_id, []);
    grouped.get(story.author_id).push(story);
  });
  storiesByAuthor = grouped;
  const sorted = [...grouped.entries()].sort(([, left], [, right]) => new Date(right[right.length - 1].created_at) - new Date(left[left.length - 1].created_at));
  sorted.forEach(([authorId, authorStories]) => {
    const profile = authorStories[0].profile || {};
    const name = authorId === currentUser?.id ? 'Seu status' : profile.display_name || profile.username || 'Usuário';
    const avatar = (profile.display_name || profile.username || name).trim().slice(0, 2).toUpperCase() || 'U';
    const button = document.createElement('button');
    button.className = `story user-story${authorStories.some((item) => item.author_id === currentUser?.id) ? ' own-story' : ''}`;
    button.type = 'button';
    button.dataset.storyAuthor = authorId;
    button.setAttribute('aria-label', `Ver status de ${name}`);
    button.innerHTML = `<div class="story-ring ring-lime"><div class="avatar avatar-lime">${escapeHtml(avatar)}</div></div><small>${escapeHtml(authorId === currentUser?.id ? `${authorStories.length} status` : name)}</small>`;
    strip.appendChild(button);
  });
}

async function loadStories() {
  if (!supabaseClient) return;
  const { data: stories, error } = await supabaseClient.from('stories')
    .select('id,author_id,body,image_url,created_at,expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error('load stories:', error);
    activeStories = [];
    renderStoryStrip();
    return;
  }
  const rows = stories || [];
  const authorIds = [...new Set(rows.map((story) => story.author_id))];
  let profilesById = new Map();
  if (authorIds.length) {
    const { data: profiles, error: profileError } = await supabaseClient.from('profiles')
      .select('id,username,display_name').in('id', authorIds);
    if (profileError) console.warn('story author profiles:', profileError);
    else profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  }
  activeStories = rows.map((story) => ({ ...story, profile: profilesById.get(story.author_id) || null }));
  renderStoryStrip();
  if (storyViewer.classList.contains('open')) {
    const currentStory = storyViewerItems[storyViewerIndex];
    if (currentStory && new Date(currentStory.expires_at) <= new Date()) closeStoryViewer();
  }
}

function startStoriesRealtime() {
  if (!supabaseClient || storyRealtimeChannel) return;
  storyRealtimeChannel = supabaseClient.channel('stories-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, () => loadStories())
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime de stories indisponível; a lista será atualizada periodicamente.');
    });
  if (!storyExpiryRefresh) storyExpiryRefresh = setInterval(loadStories, 60_000);
}

function closeStoryViewer() {
  clearTimeout(storyViewerTimer);
  storyViewerTimer = null;
  storyViewer.classList.remove('open');
  storyViewer.setAttribute('aria-hidden', 'true');
}

function openStoryViewer(authorId) {
  storyViewerItems = (storiesByAuthor.get(authorId) || []).filter((story) => new Date(story.expires_at) > new Date());
  storyViewerIndex = 0;
  if (!storyViewerItems.length) { loadStories(); return; }
  storyViewer.classList.add('open');
  storyViewer.setAttribute('aria-hidden', 'false');
  showStoryViewerItem();
}

function showStoryViewerItem() {
  clearTimeout(storyViewerTimer);
  const item = storyViewerItems[storyViewerIndex];
  if (!item || new Date(item.expires_at) <= new Date()) {
    closeStoryViewer();
    loadStories();
    return;
  }
  const profile = item.profile || {};
  const name = profile.display_name || profile.username || 'Usuário';
  const remainingMs = Math.max(0, new Date(item.expires_at) - Date.now());
  const remainingHours = Math.floor(remainingMs / 3_600_000);
  const remainingMinutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  document.getElementById('storyViewerName').textContent = name;
  document.getElementById('storyViewerAvatar').textContent = name.trim().slice(0, 2).toUpperCase() || 'U';
  document.getElementById('storyViewerExpiry').textContent = `Expira em ${remainingHours}h ${remainingMinutes}min`;
  document.getElementById('storyViewerMedia').innerHTML = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="Status de ${escapeHtml(name)}" />`
    : '';
  const text = document.getElementById('storyViewerText');
  text.textContent = item.body || '';
  text.hidden = !item.body;
  const progress = document.getElementById('storyViewerProgress');
  progress.style.display = 'none';
  progress.style.setProperty('--story-duration', '6s');
  void progress.offsetWidth;
  progress.style.display = '';
  storyViewerTimer = setTimeout(() => {
    if (storyViewerIndex < storyViewerItems.length - 1) {
      storyViewerIndex += 1;
      showStoryViewerItem();
    } else closeStoryViewer();
  }, 6000);
}

function moveStoryViewer(offset) {
  const nextIndex = storyViewerIndex + offset;
  if (nextIndex < 0 || nextIndex >= storyViewerItems.length) {
    closeStoryViewer();
    return;
  }
  storyViewerIndex = nextIndex;
  showStoryViewerItem();
}

const storyViewer = document.getElementById('storyViewer');
document.querySelector('.stories').addEventListener('click', (event) => {
  const storyButton = event.target.closest('[data-story-author]');
  if (storyButton) openStoryViewer(storyButton.dataset.storyAuthor);
});
document.getElementById('closeStoryViewer').addEventListener('click', closeStoryViewer);
document.getElementById('previousStory').addEventListener('click', () => moveStoryViewer(-1));
document.getElementById('nextStory').addEventListener('click', () => moveStoryViewer(1));
storyViewer.addEventListener('click', (event) => { if (event.target === storyViewer) closeStoryViewer(); });
document.addEventListener('keydown', (event) => {
  if (!storyViewer.classList.contains('open')) return;
  if (event.key === 'Escape') closeStoryViewer();
  if (event.key === 'ArrowRight') moveStoryViewer(1);
  if (event.key === 'ArrowLeft') moveStoryViewer(-1);
});
loadStories();
startStoriesRealtime();

function updateBalance(amount) {
  state.balance += amount;
  state.daily += amount;
  updateBalanceDisplay();
  persistWallet();
}

function updateBalanceDisplay() {
  sidebarBalance.innerHTML = `${state.balance.toFixed(6)} <small>${TOKEN}</small>`;
  dailyEarn.innerHTML = `${state.daily.toFixed(6)} <span>${TOKEN}</span>`;
  document.getElementById('walletPageBalance').textContent = state.balance.toFixed(6);
  document.getElementById('tipBalance').textContent = `${state.balance.toFixed(6)} ${TOKEN}`;
}

function updateEnergyDisplay() {
  const elapsed = Math.max(0, Date.now() - energyUpdatedAt);
  state.energy = Math.min(state.energy + (elapsed / 86400000) * state.energyCapacity, state.energyCapacity);
  energyUpdatedAt = Date.now();
  renderEnergyDisplay();
  persistWallet();
}

function renderEnergyDisplay() {
  const energy = Math.max(0, Math.min(state.energyCapacity, state.energy));
  const currentLabel = `${Math.floor(energy)}% / ${state.energyCapacity}%`;
  document.getElementById('sidebarEnergy').textContent = currentLabel;
  document.getElementById('sidebarEnergyBar').style.width = `${(energy / state.energyCapacity) * 100}%`;
  document.getElementById('composerEnergy').textContent = currentLabel;
  localStorage.setItem('socifaucEnergy', String(energy));
  localStorage.setItem('socifaucEnergyCapacity', String(state.energyCapacity));
  localStorage.setItem('socifaucEnergyUpdatedAt', String(energyUpdatedAt));
}

updateEnergyDisplay();

function openEnergyModal() {
  document.getElementById('energyAmount').value = '10';
  document.getElementById('energyAmount').max = String(Math.floor(state.energyCapacity - state.energy));
  const capacityLabel = document.getElementById('energyCapacityLabel');
  if (capacityLabel) capacityLabel.textContent = `${state.energyCapacity}%`;
  document.getElementById('energyCost').textContent = `${(10 * ENERGY_POINT_COST).toFixed(6)} ${TOKEN}`;
  document.getElementById('energyBalance').textContent = `${state.balance.toFixed(6)} ${TOKEN}`;
  document.getElementById('energyWarning').textContent = '';
  energyModal.classList.add('open');
  energyModal.setAttribute('aria-hidden', 'false');
  document.getElementById('energyAmount').focus();
}

function closeEnergyModal() {
  energyModal.classList.remove('open');
  energyModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('openEnergy').addEventListener('click', openEnergyModal);
document.getElementById('closeEnergy').addEventListener('click', closeEnergyModal);
energyModal.addEventListener('click', (event) => { if (event.target === energyModal) closeEnergyModal(); });
document.getElementById('energyAmount').addEventListener('input', (event) => {
  const amount = Math.max(0, Number(event.target.value) || 0);
  document.getElementById('energyCost').textContent = `${(amount * ENERGY_POINT_COST).toFixed(6)} ${TOKEN}`;
});
document.getElementById('confirmEnergy').addEventListener('click', () => {
  const amount = Number(document.getElementById('energyAmount').value);
  const warning = document.getElementById('energyWarning');
  const cost = amount * ENERGY_POINT_COST;
  if (!Number.isInteger(amount) || amount < 1) { warning.textContent = 'Escolha uma quantidade inteira de pontos de energia.'; return; }
  if (amount > Math.floor(state.energyCapacity - state.energy)) { warning.textContent = `Você só pode comprar mais ${Math.floor(state.energyCapacity - state.energy)} pontos agora.`; return; }
  if (cost > state.balance) { warning.textContent = `Saldo insuficiente. Esta compra custa ${cost.toFixed(6)} SFC.`; return; }
  state.balance -= cost;
  state.energy += amount;
  sidebarBalance.innerHTML = `${state.balance.toFixed(6)} <small>${TOKEN}</small>`;
  dailyEarn.innerHTML = `${state.daily.toFixed(6)} <span>${TOKEN}</span>`;
  document.getElementById('walletPageBalance').textContent = state.balance.toFixed(6);
  document.getElementById('energyBalance').textContent = `${state.balance.toFixed(6)} ${TOKEN}`;
  updateEnergyDisplay();
  closeEnergyModal();
  showToast(`${amount}% de energia adicionada por ${cost.toFixed(6)} SFC`);
});

document.getElementById('energyCaktoButton').addEventListener('click', async () => {
  const button = document.getElementById('energyCaktoButton');
  const warning = document.getElementById('energyWarning');
  warning.textContent = '';
  if (!supabaseClient || !currentUser) {
    warning.textContent = 'Entre na sua conta antes de comprar a recarga.';
    openAuth();
    return;
  }
  if (state.energy >= state.energyCapacity) {
    warning.textContent = 'Sua energia já está em 100%.';
    return;
  }

  const checkoutWindow = window.open('about:blank', '_blank');
  if (!checkoutWindow) {
    warning.textContent = 'Permita a abertura da nova aba para continuar ao checkout.';
    return;
  }
  checkoutWindow.opener = null;
  button.disabled = true;
  button.textContent = 'Preparando checkout…';
  let callbackToken = null;
  let checkoutError = null;
  try {
    const result = await supabaseClient.rpc('create_energy_checkout_session');
    callbackToken = result.data;
    checkoutError = result.error;
  } catch (error) {
    checkoutError = error;
  }
  button.disabled = false;
  button.innerHTML = 'Restaurar 100% com Cakto <span>↗</span>';
  if (checkoutError || !callbackToken) {
    checkoutWindow.close();
    console.error('create Cakto energy checkout:', checkoutError);
    warning.textContent = `Não foi possível iniciar o pagamento: ${checkoutError?.message || 'sessão inválida'}. Configure supabase-cakto-energy.sql.`;
    return;
  }
  const checkout = new URL('https://pay.cakto.com.br/seyuwav_1131179');
  checkout.searchParams.set('callback', callbackToken);
  checkoutWindow.location.href = checkout.toString();
});

function getPostId(post) {
  if (!post.dataset.postId) post.dataset.postId = `post-${[...document.querySelectorAll('#feedPosts > .post')].indexOf(post) + 1}`;
  return post.dataset.postId;
}

function hasActionReward(post, action) {
  const rewards = JSON.parse(localStorage.getItem('socifaucActionRewards') || '{}');
  return rewards[`${getPostId(post)}:${action}`] === true;
}

function claimActionReward(post, action) {
  const rewards = JSON.parse(localStorage.getItem('socifaucActionRewards') || '{}');
  const key = `${getPostId(post)}:${action}`;
  if (rewards[key]) return false;
  rewards[key] = true;
  localStorage.setItem('socifaucActionRewards', JSON.stringify(rewards));
  return true;
}

function rewardPostOwner(post) {
  const reward = Number(rewardSettings.like_reward);
  const owner = post.querySelector('.post-author strong')?.textContent.replace('✓', '').trim() || 'criador';
  const earned = post.querySelector('.post-stats .earned');
  const currentText = earned?.textContent.match(/[\d.]+/)?.[0] || '0';
  const currentValue = Number(currentText);
  if (earned) earned.textContent = `+${(currentValue + reward).toFixed(6)} ${TOKEN}`;
  if (post.dataset.authorId === currentUser?.id) updateBalance(reward);
  return owner;
}

document.querySelectorAll('.like-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const count = button.querySelector('span');
    const countText = count.textContent.trim().toLowerCase();
    const currentValue = countText.endsWith('k') ? parseFloat(countText) * 1000 : Number(countText);
    const value = currentValue + (button.classList.contains('liked') ? -1 : 1);
    count.textContent = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value;
    button.classList.toggle('liked');
    if (button.classList.contains('liked')) {
      const post = button.closest('.post');
      if (claimActionReward(post, 'like')) {
        const owner = rewardPostOwner(post);
        showToast(`${owner} recebeu +${Number(rewardSettings.like_reward).toFixed(6)} ${TOKEN} pela curtida`);
      } else showToast('Curtida restaurada; bônus já recebido neste post');
    }
  });
});

document.querySelectorAll('.tip-btn').forEach((button) => {
  button.addEventListener('click', () => {
    openTipModal(button);
  });
});

function openTipModal(button) {
  tipModal.dataset.postId = button.closest('.post').dataset.postId || '';
  tipModal.dataset.recipientId = button.closest('.post').dataset.authorId || '';
  const author = button.closest('.post').querySelector('.post-author strong');
  document.getElementById('tipRecipient').textContent = author ? author.textContent.replace('✓', '').trim() : 'criador';
  document.getElementById('tipAmount').value = '0.020000';
  document.getElementById('tipMessage').value = '';
  document.getElementById('tipBalance').textContent = `${state.balance.toFixed(6)} ${TOKEN}`;
  tipModal.classList.add('open');
  tipModal.style.opacity = '1';
  tipModal.style.visibility = 'visible';
  tipModal.setAttribute('aria-hidden', 'false');
  document.getElementById('tipAmount').focus();
}

function closeTipModal() {
  tipModal.classList.remove('open');
  tipModal.style.opacity = '0';
  tipModal.style.visibility = 'hidden';
  tipModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('closeTip').addEventListener('click', closeTipModal);
tipModal.addEventListener('click', (event) => { if (event.target === tipModal) closeTipModal(); });
document.getElementById('confirmTip').addEventListener('click', async () => {
  const amount = Number(document.getElementById('tipAmount').value);
  if (!Number.isFinite(amount) || amount < 0.000001) { showToast('Informe um valor válido'); return; }
  if (amount > state.balance) { showToast('Saldo insuficiente para enviar esta gorjeta'); return; }
  state.balance -= amount;
  state.daily -= amount;
  sidebarBalance.innerHTML = `${state.balance.toFixed(6)} <small>${TOKEN}</small>`;
  dailyEarn.innerHTML = `${state.daily.toFixed(6)} <span>${TOKEN}</span>`;
  document.getElementById('walletPageBalance').textContent = state.balance.toFixed(6);
  const recipient = document.getElementById('tipRecipient').textContent;
  const message = document.getElementById('tipMessage').value.trim();
  if (supabaseClient && currentUser && tipModal.dataset.recipientId && tipModal.dataset.postId.length > 30) {
    const { error } = await supabaseClient.from('tips').insert({ post_id: tipModal.dataset.postId, sender_id: currentUser.id, recipient_id: tipModal.dataset.recipientId, amount_sfc: amount, message });
    if (error) { showToast('Não foi possível salvar a gorjeta'); return; }
  }
  await persistWallet();
  closeTipModal();
  showToast(`-${amount.toFixed(6)} SFC enviados para ${recipient}${message ? ' · mensagem enviada' : ''}`);
});

function getPostCommentCount(button) {
  const stats = button.closest('.post').querySelector('.post-stats');
  return [...stats.querySelectorAll('span')].find((item) => item.textContent.includes('coment'));
}

function parseDisplayedPostCount(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.endsWith('k')) return Math.round((Number.parseFloat(text) || 0) * 1000);
  return Number(text.replace(/[^\d]/g, '')) || 0;
}

function formatCompactPostCount(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value);
}

function updatePostEngagementCount(post, type, value) {
  const label = type === 'like' ? 'curtidas' : 'comentários';
  const actionSelector = type === 'like' ? '.like-btn span' : '.comment-btn span';
  const statsCount = [...post.querySelectorAll('.post-stats span')].find((item) => item.textContent.includes(label));
  const actionCount = post.querySelector(actionSelector);
  if (statsCount) statsCount.textContent = `${value.toLocaleString('pt-BR')} ${label}`;
  if (actionCount) actionCount.textContent = formatCompactPostCount(value);
}

function addCommentBox(button) {
  const post = button.closest('.post');
  const existing = post.querySelector('.inline-comment-box');
  if (existing) { existing.remove(); return; }
  const box = document.createElement('form');
  box.className = 'inline-comment-box';
  box.innerHTML = '<input type="text" maxlength="240" placeholder="Escreva um comentário..." aria-label="Comentário" /><button type="submit">Enviar</button>';
  post.querySelector('.post-actions').after(box);
  box.querySelector('input').focus();
  box.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = box.querySelector('input');
    if (!input.value.trim()) return;
    let savedRemotely = false;
    if (supabaseClient && currentUser && post.dataset.postId.length > 30) {
      const { error } = await supabaseClient.from('comments').insert({ post_id: post.dataset.postId, author_id: currentUser.id, body: input.value.trim() });
      if (error) { showToast('Não foi possível salvar o comentário'); return; }
      savedRemotely = true;
    }
    const count = getPostCommentCount(button);
    let current = parseDisplayedPostCount(count?.textContent) + 1;
    if (savedRemotely) {
      const [{ data: postCounts }] = await Promise.all([
        supabaseClient.from('posts').select('comments_count').eq('id', post.dataset.postId).maybeSingle(),
        loadUserData(currentUser)
      ]);
      if (postCounts) current = Number(postCounts.comments_count || 0);
    }
    updatePostEngagementCount(post, 'comment', current);
    const earnedCommentReward = savedRemotely || claimActionReward(post, 'comment');
    if (!savedRemotely && earnedCommentReward) updateBalance(Number(rewardSettings.comment_reward));
    if (savedRemotely && post.dataset.adCampaignId) recordSponsoredPostEvent(post.dataset.adCampaignId, 'engagement');
    box.remove();
    showToast(earnedCommentReward ? `+${Number(rewardSettings.comment_reward).toFixed(6)} ${TOKEN} por comentar` : 'Comentário publicado; bônus já recebido neste post');
  });
}

document.getElementById('feedPosts').addEventListener('click', (event) => {
  const sponsoredPost = event.target.closest('.post[data-ad-campaign-id]');
  if (sponsoredPost && !event.target.closest('.post-actions')) {
    recordSponsoredPostEvent(sponsoredPost.dataset.adCampaignId, 'click');
  }
  const button = event.target.closest('.post-actions button');
  if (!button) return;
  const buttons = [...button.parentElement.children];
  const action = buttons.indexOf(button) === 1 ? 'comment' : buttons.indexOf(button) === 2 ? 'repost' : '';
  if (buttons.indexOf(button) === 0 && supabaseClient && currentUser) {
    const post = button.closest('.post');
    const postId = post.dataset.postId;
    const previouslyLiked = button.classList.contains('liked');
    const liked = !previouslyLiked;
    button.classList.toggle('liked', liked);
    const count = button.querySelector('span');
    const previousCount = parseDisplayedPostCount(count.textContent);
    const value = Math.max(0, previousCount + (liked ? 1 : -1));
    updatePostEngagementCount(post, 'like', value);
    button.disabled = true;
    const request = liked
      ? supabaseClient.from('post_likes').insert({ post_id: postId, user_id: currentUser.id })
      : supabaseClient.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
    request.then(async ({ error }) => {
      button.disabled = false;
      if (error) {
        button.classList.toggle('liked', previouslyLiked);
        updatePostEngagementCount(post, 'like', previousCount);
        showToast('Não foi possível salvar a curtida. A contagem foi restaurada.');
        console.error('Supabase like:', error);
        return;
      }
      if (liked && post.dataset.adCampaignId) recordSponsoredPostEvent(post.dataset.adCampaignId, 'engagement');
      if (liked && post.dataset.authorId === currentUser.id) await loadUserData(currentUser);
    });
    return;
  }
  if (action === 'comment') addCommentBox(button);
  if (action === 'repost') {
    const reposted = button.classList.toggle('reposted');
    button.querySelector('span').textContent = reposted ? 'Repostado' : 'Repostar';
    const post = button.closest('.post');
    const savedRemotely = Boolean(supabaseClient && currentUser && post.dataset.postId.length > 30);
    const repostRequest = reposted && savedRemotely
      ? supabaseClient.from('reposts').insert({ post_id: post.dataset.postId, user_id: currentUser.id })
      : !reposted && supabaseClient && currentUser
        ? supabaseClient.from('reposts').delete().eq('post_id', post.dataset.postId).eq('user_id', currentUser.id)
        : null;
    if (repostRequest) repostRequest.then(({ error }) => {
      if (error) showToast('Não foi possível salvar o repost');
      else if (reposted && savedRemotely) {
        if (post.dataset.adCampaignId) recordSponsoredPostEvent(post.dataset.adCampaignId, 'engagement');
        loadUserData(currentUser);
      }
    });
    if (reposted && !savedRemotely && claimActionReward(post, 'repost')) {
      updateBalance(Number(rewardSettings.repost_reward));
      showToast(`+${Number(rewardSettings.repost_reward).toFixed(6)} ${TOKEN} por repostar`);
    } else if (reposted) showToast('Repost restaurado; bônus já recebido neste post');
  }
});

document.querySelectorAll('.nav-item, [data-section="wallet"], [data-section="feed"]').forEach((button) => {
  button.addEventListener('click', () => {
    const section = button.dataset.section;
    if (section === 'wallet') showWalletPage();
    if (section === 'explore') showExplorePage();
    if (section === 'advertising') showAdvertisingPage();
    if (section === 'notifications') showNotificationsPage();
    if (section === 'messages') showMessagesPage();
    if (section === 'profile') showProfilePage();
    if (section === 'feed') showFeed();
    if (section === 'admin') showAdminPage();
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    if (button.classList.contains('nav-item')) button.classList.add('active');
  });
});

function showProfilePage() {
  contentWrap.style.display = 'none';
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  profilePage.classList.add('visible');
  syncProfilePage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showWalletPage() {
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  walletPage.classList.add('visible');
  document.getElementById('walletPageBalance').textContent = state.balance.toFixed(6);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openWithdrawModal() {
  document.getElementById('withdrawBalance').textContent = `${state.balance.toFixed(6)} ${TOKEN}`;
  document.getElementById('withdrawAmount').value = '';
  document.getElementById('withdrawWallet').value = '';
  document.getElementById('withdrawWarning').textContent = '';
  withdrawModal.classList.add('open');
  withdrawModal.setAttribute('aria-hidden', 'false');
  document.getElementById('withdrawWallet').focus();
}

function closeWithdrawModal() {
  withdrawModal.classList.remove('open');
  withdrawModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('openWithdraw').addEventListener('click', openWithdrawModal);
document.getElementById('closeWithdraw').addEventListener('click', closeWithdrawModal);
withdrawModal.addEventListener('click', (event) => { if (event.target === withdrawModal) closeWithdrawModal(); });
document.getElementById('confirmWithdraw').addEventListener('click', async () => {
  const wallet = document.getElementById('withdrawWallet').value.trim();
  const amount = Number(document.getElementById('withdrawAmount').value);
  const warning = document.getElementById('withdrawWarning');
  const isPolygonWallet = /^0x[a-fA-F0-9]{40}$/.test(wallet);
  if (!isPolygonWallet) { warning.textContent = 'Informe um endereço Polygon válido começando com 0x.'; return; }
  if (!Number.isFinite(amount) || amount < 0.000001) { warning.textContent = 'Informe uma quantidade maior que 0.000000 SFC.'; return; }
  if (amount > state.balance) { warning.textContent = 'A quantidade solicitada é maior que seu saldo disponível.'; return; }
  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient.from('withdrawals').insert({
      user_id: currentUser.id,
      polygon_wallet: wallet,
      amount_sfc: amount,
      status: 'pending'
    });
    if (error) {
      console.error('Supabase withdrawal:', error);
      warning.textContent = 'Não foi possível enviar o pedido. Execute supabase-admin.sql no Supabase.';
      return;
    }
  }
  state.balance -= amount;
  state.daily = Math.max(0, state.daily - amount);
  sidebarBalance.innerHTML = `${state.balance.toFixed(6)} <small>${TOKEN}</small>`;
  dailyEarn.innerHTML = `${state.daily.toFixed(6)} <span>${TOKEN}</span>`;
  document.getElementById('walletPageBalance').textContent = state.balance.toFixed(6);
  persistWallet();
  closeWithdrawModal();
  showToast(`Saque de ${amount.toFixed(6)} SFC enviado para análise`);
});

function showExplorePage() {
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  explorePage.classList.add('visible');
  loadExploreData();
  startExploreRealtime();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAdvertisingPage() {
  if (!supabaseClient) { showToast('Configure o Supabase para anunciar'); return; }
  if (!currentUser) { showToast('Entre na sua conta para criar campanhas'); openAuth(); return; }
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  advertisingPage.classList.add('visible');
  loadAdComposerPosts();
  loadAdCampaigns();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateAdBudgetPreview() {
  const budgetInput = document.getElementById('adBudgetInput');
  const preview = document.getElementById('adBudgetPreview');
  if (!budgetInput || !preview) return;
  const budget = Number(budgetInput.value);
  const cpm = Number(rewardSettings.ad_cpm_sfc || 10);
  if (!Number.isFinite(budget) || budget <= 0 || cpm <= 0) {
    preview.textContent = `CPM atual: ${cpm.toFixed(6)} SFC por 1.000 impressões.`;
    return;
  }
  const impressions = Math.floor((budget / cpm) * 1000);
  preview.textContent = `${budget.toFixed(6)} SFC podem gerar cerca de ${impressions.toLocaleString('pt-BR')} impressões no CPM atual. O orçamento será cobrado ao ativar.`;
}

async function loadAdComposerPosts() {
  const select = document.getElementById('adPostSelect');
  select.innerHTML = '<option value="">Carregando seus posts...</option>';
  const { data, error } = await supabaseClient.from('posts')
    .select('id,body,image_url,poll_question,created_at')
    .eq('author_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('ad post options:', error);
    select.innerHTML = '<option value="">Não foi possível carregar seus posts</option>';
    document.getElementById('adCampaignStatus').textContent = 'Confira as permissões de posts no Supabase.';
    return;
  }
  if (!data?.length) {
    select.innerHTML = '<option value="">Publique um post antes de anunciar</option>';
    return;
  }
  select.innerHTML = '<option value="">Selecione um post</option>' + data.map((post) => {
    const title = post.body?.trim() || post.poll_question || (post.image_url ? 'Post com imagem' : 'Publicação');
    const date = new Date(post.created_at).toLocaleDateString('pt-BR');
    return `<option value="${escapeHtml(post.id)}">${escapeHtml(title.slice(0, 75))} · ${date}</option>`;
  }).join('');
}

function renderAdCampaigns(campaigns, postsById = new Map()) {
  const list = document.getElementById('adCampaignList');
  const totals = campaigns.reduce((result, campaign) => ({
    impressions: result.impressions + Number(campaign.impressions_count || 0),
    clicks: result.clicks + Number(campaign.clicks_count || 0),
    engagements: result.engagements + Number(campaign.engagements_count || 0),
    spent: result.spent + Number(campaign.spent_sfc || 0)
  }), { impressions: 0, clicks: 0, engagements: 0, spent: 0 });
  document.getElementById('adsTotalImpressions').textContent = totals.impressions.toLocaleString('pt-BR');
  document.getElementById('adsTotalClicks').textContent = totals.clicks.toLocaleString('pt-BR');
  document.getElementById('adsTotalEngagements').textContent = totals.engagements.toLocaleString('pt-BR');
  document.getElementById('adsTotalSpent').textContent = `${totals.spent.toFixed(6)} SFC`;
  if (!campaigns.length) {
    list.innerHTML = '<div class="ads-empty">Você ainda não criou campanhas.</div>';
    return;
  }

  const statusLabels = { active: 'Ativa', paused: 'Pausada', exhausted: 'Orçamento usado', cancelled: 'Cancelada' };
  list.innerHTML = campaigns.map((campaign) => {
    const post = postsById.get(campaign.post_id) || {};
    const title = post.body?.trim() || post.poll_question || (post.image_url ? 'Post com imagem' : 'Publicação');
    const budget = Number(campaign.budget_sfc || 0);
    const spent = Number(campaign.spent_sfc || 0);
    const progress = budget ? Math.min(100, (spent / budget) * 100) : 0;
    const clicks = Number(campaign.clicks_count || 0);
    const impressions = Number(campaign.impressions_count || 0);
    const ctr = impressions ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
    const actions = campaign.status === 'active'
      ? `<button type="button" data-campaign-action="pause" data-campaign-id="${escapeHtml(campaign.id)}">Pausar</button>`
      : campaign.status === 'paused'
        ? `<button type="button" data-campaign-action="resume" data-campaign-id="${escapeHtml(campaign.id)}">Retomar</button>`
        : '';
    const cancelButton = campaign.status === 'cancelled' ? '' : `<button class="danger" type="button" data-campaign-action="cancel" data-campaign-id="${escapeHtml(campaign.id)}">Cancelar e reembolsar saldo restante</button>`;
    return `<article class="ads-campaign"><div class="ads-campaign-head"><strong>${escapeHtml(title.slice(0, 110))}</strong><span class="ads-campaign-status ${escapeHtml(campaign.status)}">${statusLabels[campaign.status] || 'Indefinida'}</span></div><div class="ads-campaign-stats"><span>Impressões<b>${impressions.toLocaleString('pt-BR')}</b></span><span>Cliques · CTR<b>${clicks.toLocaleString('pt-BR')} · ${ctr}%</b></span><span>Engajamentos<b>${Number(campaign.engagements_count || 0).toLocaleString('pt-BR')}</b></span><span>CPM<b>${Number(campaign.cpm_sfc || 0).toFixed(3)} SFC</b></span></div><div class="ads-campaign-progress"><i style="width:${progress.toFixed(2)}%"></i></div><div class="ads-campaign-meta"><span>${spent.toFixed(6)} / ${budget.toFixed(6)} SFC investidos</span><span>${new Date(campaign.created_at).toLocaleDateString('pt-BR')}</span></div><div class="ads-campaign-actions">${actions}${cancelButton}</div></article>`;
  }).join('');
}

async function loadAdCampaigns() {
  const list = document.getElementById('adCampaignList');
  if (!supabaseClient || !currentUser) return;
  const requestId = ++adCampaignRequestId;
  list.innerHTML = '<div class="ads-empty">Carregando campanhas...</div>';
  const { data, error } = await supabaseClient.from('ad_campaigns')
    .select('id,post_id,budget_sfc,spent_sfc,cpm_sfc,status,impressions_count,clicks_count,engagements_count,created_at')
    .eq('advertiser_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (requestId !== adCampaignRequestId) return;
  if (error) {
    console.error('load ad campaigns:', error);
    list.innerHTML = '<div class="ads-empty">Não foi possível carregar campanhas. Execute supabase-ads.sql no Supabase.</div>';
    return;
  }
  let postsById = new Map();
  if (data?.length) {
    const { data: posts, error: postsError } = await supabaseClient.from('posts')
      .select('id,body,image_url,poll_question').in('id', data.map((campaign) => campaign.post_id));
    if (postsError) console.warn('load ad campaign posts:', postsError);
    postsById = new Map((posts || []).map((post) => [post.id, post]));
  }
  if (requestId === adCampaignRequestId) renderAdCampaigns(data || [], postsById);
}

document.getElementById('adBudgetInput').addEventListener('input', updateAdBudgetPreview);
document.getElementById('refreshAdCampaigns').addEventListener('click', loadAdCampaigns);
document.getElementById('advertisingBack').addEventListener('click', showFeed);
document.getElementById('adCampaignForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('adCampaignStatus');
  const button = document.getElementById('createAdCampaignButton');
  const postId = document.getElementById('adPostSelect').value;
  const budget = Number(document.getElementById('adBudgetInput').value);
  if (!currentUser || !postId || !Number.isFinite(budget) || budget < 1) {
    status.textContent = 'Selecione um post seu e informe um orçamento de pelo menos 1 SFC.';
    return;
  }
  button.disabled = true;
  status.dataset.state = '';
  status.textContent = 'Verificando saldo e ativando campanha...';
  const { data, error } = await supabaseClient.rpc('create_ad_campaign', { p_post_id: postId, p_budget_sfc: budget });
  button.disabled = false;
  if (error) {
    console.error('create ad campaign:', error);
    status.dataset.state = 'error';
    status.textContent = error.message.includes('create_ad_campaign')
      ? 'Execute supabase-ads.sql no Supabase para ativar campanhas.'
      : error.message;
    return;
  }
  status.dataset.state = 'success';
  status.textContent = 'Campanha ativada. O orçamento foi reservado da sua carteira.';
  document.getElementById('adBudgetInput').value = '10';
  updateAdBudgetPreview();
  await Promise.all([loadUserData(currentUser), loadAdCampaigns()]);
  showToast(`Campanha ativada com orçamento de ${budget.toFixed(6)} SFC`);
});

document.getElementById('adCampaignList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-campaign-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.campaignAction;
  if (action === 'cancel' && !window.confirm('Cancelar esta campanha e devolver o orçamento não utilizado para sua carteira?')) return;
  button.disabled = true;
  const { data, error } = await supabaseClient.rpc('set_ad_campaign_status', {
    p_campaign_id: button.dataset.campaignId,
    p_action: action
  });
  button.disabled = false;
  if (error) {
    console.error('update ad campaign:', error);
    showToast('Não foi possível atualizar a campanha. Confira supabase-ads.sql.');
    return;
  }
  await Promise.all([loadUserData(currentUser), loadAdCampaigns()]);
  showToast(action === 'cancel' ? `${Number(data || 0).toFixed(6)} SFC devolvidos à carteira` : action === 'pause' ? 'Campanha pausada' : 'Campanha retomada');
});

function showMessagesPage() {
  if (!supabaseClient) { showToast('Configure o Supabase para usar as mensagens'); return; }
  if (!currentUser) { showToast('Entre na sua conta para acessar as mensagens'); openAuth(); return; }
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  messagesPage.classList.add('visible');
  startMessagesRealtime();
  refreshMessagesPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showNotificationsPage() {
  if (!supabaseClient) { showToast('Configure o Supabase para usar as notificações'); return; }
  if (!currentUser) { showToast('Entre na sua conta para ver notificações'); openAuth(); return; }
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  notificationsPage.classList.add('visible');
  loadNotifications();
  updateNotificationBadge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function stopNotificationsRealtime() {
  if (!notificationsRealtimeChannel || !supabaseClient) return;
  const channel = notificationsRealtimeChannel;
  notificationsRealtimeChannel = null;
  supabaseClient.removeChannel(channel);
}

function startNotificationsRealtime() {
  if (!supabaseClient || !currentUser || notificationsRealtimeChannel) return;
  const userId = currentUser.id;
  notificationsRealtimeChannel = supabaseClient.channel(`notifications-${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_id=eq.${userId}`
    }, (payload) => {
      if (notificationsPage.classList.contains('visible')) loadNotifications();
      updateNotificationBadge();
      showToast(`Nova notificação: ${notificationSummary(payload.new.type, payload.new.content)}`);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime de notificações indisponível; abra a aba para atualizar manualmente.');
    });
}

async function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!supabaseClient || !currentUser) {
    badge.hidden = true;
    return;
  }
  const { count, error } = await supabaseClient.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', currentUser.id)
    .is('read_at', null);
  if (error) {
    console.warn('notification unread count:', error);
    return;
  }
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count || '');
  document.getElementById('markAllNotificationsRead').disabled = !count;
}

function notificationSummary(type, content = '') {
  const actions = {
    like: 'curtiu sua publicação',
    comment: content ? `comentou: “${content}”` : 'comentou na sua publicação',
    repost: 'compartilhou sua publicação',
    tip: content || 'enviou uma gorjeta',
    follow: 'começou a seguir você',
    message: content ? `enviou uma mensagem: “${content}”` : 'enviou uma mensagem',
    new_post: content ? `publicou: “${content}”` : 'publicou uma atualização'
  };
  return actions[type] || 'interagiu com você';
}

function notificationTime(dateValue) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000));
  if (seconds < 60) return 'agora';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
}

async function loadNotifications() {
  if (!supabaseClient || !currentUser) return;
  const list = document.getElementById('notificationsList');
  list.innerHTML = '<div class="notification-empty">Carregando notificações…</div>';
  let query = supabaseClient.from('notifications')
    .select('id,recipient_id,actor_id,type,post_id,source_id,content,created_at,read_at')
    .eq('recipient_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (notificationFilter === 'unread') query = query.is('read_at', null);
  const { data: notifications, error } = await query;
  if (error) {
    console.error('load notifications:', error);
    list.innerHTML = `<div class="notification-empty notification-error">Não foi possível carregar notificações: ${escapeHtml(error.message)}. Execute <code>supabase-notifications.sql</code> no Supabase.</div>`;
    return;
  }
  const rows = notifications || [];
  const actorIds = [...new Set(rows.map((notification) => notification.actor_id))];
  notificationProfilesById = new Map();
  if (actorIds.length) {
    const { data: profiles, error: profilesError } = await supabaseClient.from('profiles')
      .select('id,username,display_name,avatar_url').in('id', actorIds);
    if (profilesError) console.warn('notification actor profiles:', profilesError);
    else notificationProfilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  }
  if (!rows.length) {
    list.innerHTML = `<div class="notification-empty">${notificationFilter === 'unread' ? 'Você está em dia. Não há notificações não lidas.' : 'Ainda não há notificações. Curtidas, comentários, seguidores, mensagens e outras interações aparecerão aqui.'}</div>`;
    return;
  }
  list.innerHTML = rows.map((notification) => {
    const profile = notificationProfilesById.get(notification.actor_id) || {};
    const actor = profile.display_name || profile.username || 'Alguém';
    const initial = actor.trim().slice(0, 2).toUpperCase() || 'U';
    const avatar = profile.avatar_url
      ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" />`
      : escapeHtml(initial);
    return `<button class="notification-item${notification.read_at ? '' : ' unread'}" type="button" data-notification-id="${escapeHtml(notification.id)}" data-notification-type="${escapeHtml(notification.type)}" data-actor-id="${escapeHtml(notification.actor_id)}" data-post-id="${escapeHtml(notification.post_id || '')}">
      <span class="notification-avatar">${avatar}</span>
      <span class="notification-copy"><strong>${escapeHtml(actor)}</strong> ${escapeHtml(notificationSummary(notification.type, notification.content))}<span>${escapeHtml(profile.username ? `@${profile.username} · ` : '')}${escapeHtml(notificationTime(notification.created_at))}</span></span>
      <span class="notification-time">${escapeHtml(new Date(notification.created_at).toLocaleDateString('pt-BR'))}</span>
      <span class="notification-unread-dot"${notification.read_at ? ' hidden' : ''}></span>
    </button>`;
  }).join('');
}

async function markNotificationRead(notificationId) {
  if (!supabaseClient || !currentUser || !notificationId) return;
  const { error } = await supabaseClient.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_id', currentUser.id)
    .is('read_at', null);
  if (error) console.error('mark notification read:', error);
  await Promise.all([updateNotificationBadge(), loadNotifications()]);
}

async function markAllNotificationsRead() {
  if (!supabaseClient || !currentUser) return;
  const button = document.getElementById('markAllNotificationsRead');
  button.disabled = true;
  const { error } = await supabaseClient.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', currentUser.id)
    .is('read_at', null);
  button.disabled = false;
  if (error) {
    console.error('mark all notifications read:', error);
    showToast(`Não foi possível marcar como lidas: ${error.message}`);
    return;
  }
  await Promise.all([updateNotificationBadge(), loadNotifications()]);
}

async function openNotification(notification) {
  const { notificationId, type, actorId, postId } = notification;
  const actorProfile = notificationProfilesById.get(actorId);
  await markNotificationRead(notificationId);
  if (type === 'message') {
    messageProfilesById.set(actorId, actorProfile || { id: actorId });
    activeMessageRecipientId = actorId;
    showMessagesPage();
    return;
  }
  showFeed();
  if (postId) {
    const post = document.querySelector(`#feedPosts [data-post-id="${CSS.escape(postId)}"]`);
    if (post) {
      post.scrollIntoView({ behavior: 'smooth', block: 'center' });
      post.classList.add('notification-target');
      setTimeout(() => post.classList.remove('notification-target'), 2200);
    }
  }
}

function stopMessagesRealtime() {
  if (!messagesRealtimeChannel || !supabaseClient) return;
  const channel = messagesRealtimeChannel;
  messagesRealtimeChannel = null;
  supabaseClient.removeChannel(channel);
}

function startMessagesRealtime() {
  if (!supabaseClient || !currentUser || messagesRealtimeChannel) return;
  messagesRealtimeChannel = supabaseClient
    .channel(`direct-messages-${currentUser.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
      const message = payload.new;
      if (message.sender_id !== currentUser?.id && message.recipient_id !== currentUser?.id) return;
      refreshMessagesPage();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime de mensagens indisponível; use Atualizar para buscar novas mensagens.');
    });
}

function renderMessageContact(profile, { preview = '', showFollow = false, following = false } = {}) {
  const id = escapeHtml(profile.id);
  const name = profile.display_name || profile.username || 'Usuário';
  const username = profile.username || 'usuario';
  const initial = name.trim().slice(0, 2).toUpperCase() || 'U';
  return `<div class="message-contact">
    <button class="message-contact-open" type="button" data-message-user-id="${id}" aria-label="Abrir conversa com ${escapeHtml(name)}">
      <span class="message-avatar">${escapeHtml(initial)}</span><span class="message-contact-copy"><strong>${escapeHtml(name)}</strong><small>${preview ? escapeHtml(preview) : `@${escapeHtml(username)}`}</small></span>
    </button>
    ${showFollow ? `<button class="message-follow-button${following ? ' following' : ''}" type="button" data-follow-id="${id}" data-following="${following}">${following ? 'Seguindo' : 'Seguir'}</button>` : ''}
  </div>`;
}

async function searchMessageProfiles() {
  const results = document.getElementById('messageSearchResults');
  const term = document.getElementById('messageUserSearch').value.trim().replace(/[%_,]/g, ' ');
  if (term.length < 2) {
    results.innerHTML = '<div class="messages-hint">Digite ao menos 2 caracteres para buscar perfis.</div>';
    return;
  }
  if (!supabaseClient || !currentUser) {
    results.innerHTML = '<div class="messages-hint">Entre na sua conta para buscar perfis.</div>';
    return;
  }
  results.innerHTML = '<div class="messages-hint">Buscando perfis…</div>';
  const { data: profiles, error } = await supabaseClient.from('profiles')
    .select('id,username,display_name')
    .ilike('username', `%${term}%`)
    .neq('id', currentUser.id)
    .limit(15);
  if (error) {
    console.error('message profile search:', error);
    results.innerHTML = `<div class="messages-hint">Erro na busca: ${escapeHtml(error.message)}.</div>`;
    return;
  }
  if (!profiles?.length) {
    results.innerHTML = '<div class="messages-hint">Nenhum perfil encontrado.</div>';
    return;
  }

  profiles.forEach((profile) => messageProfilesById.set(profile.id, profile));
  const { data: follows, error: followsError } = await supabaseClient.from('follows')
    .select('following_id').eq('follower_id', currentUser.id).in('following_id', profiles.map((profile) => profile.id));
  if (followsError) console.warn('message follow lookup:', followsError);
  const followingIds = new Set((follows || []).map((follow) => follow.following_id));
  results.innerHTML = profiles.map((profile) => renderMessageContact(profile, {
    showFollow: true,
    following: followingIds.has(profile.id)
  })).join('');
}

async function refreshMessagesPage() {
  if (!supabaseClient || !currentUser) return;
  const followersList = document.getElementById('messageFollowersList');
  const recentList = document.getElementById('messageRecentList');
  followersList.innerHTML = '<div class="messages-hint">Carregando seguidores…</div>';
  const userId = currentUser.id;
  const [followsResult, messagesResult] = await Promise.all([
    supabaseClient.from('follows').select('follower_id,created_at').eq('following_id', userId).order('created_at', { ascending: false }).limit(100),
    supabaseClient.from('direct_messages').select('id,sender_id,recipient_id,body,created_at').or(`sender_id.eq.${userId},recipient_id.eq.${userId}`).order('created_at', { ascending: false }).limit(300)
  ]);

  if (messagesResult.error) {
    console.error('load direct messages:', messagesResult.error);
    const detail = escapeHtml(messagesResult.error.message || 'tabelas ou políticas ainda não configuradas');
    recentList.innerHTML = `<div class="messages-hint">Não foi possível carregar mensagens (${detail}). Execute <code>supabase-messages.sql</code> no SQL Editor do Supabase.</div>`;
  }
  if (followsResult.error) {
    console.error('load followers:', followsResult.error);
    followersList.innerHTML = `<div class="messages-hint">Não foi possível carregar seguidores: ${escapeHtml(followsResult.error.message)}. Confira a tabela e as políticas de <code>follows</code>.</div>`;
  }

  const followerRows = followsResult.data || [];
  const followerIds = followerRows.map((follow) => follow.follower_id);
  const messages = messagesResult.data || [];
  const latestByUser = new Map();
  messages.forEach((message) => {
    const otherId = message.sender_id === userId ? message.recipient_id : message.sender_id;
    if (!latestByUser.has(otherId)) latestByUser.set(otherId, message);
  });
  const profileIds = [...new Set([...followerIds, ...latestByUser.keys()])];
  let profiles = [];
  if (profileIds.length) {
    const { data, error } = await supabaseClient.from('profiles').select('id,username,display_name').in('id', profileIds);
    if (error) console.warn('load message profiles:', error);
    else profiles = data || [];
  }
  profiles.forEach((profile) => messageProfilesById.set(profile.id, profile));
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const followersLoaded = !followsResult.error;
  const followerSet = new Set(followerIds);
  messageFollowerIds = followerSet;

  if (followersLoaded) {
    followersList.innerHTML = followerIds.length
      ? followerIds.map((id) => renderMessageContact(profilesById.get(id) || { id, username: 'usuario' })).join('')
      : '<div class="messages-hint">Você ainda não tem seguidores. Para enviar mensagens, outras pessoas precisam seguir seu perfil.</div>';
  }
  if (!messagesResult.error) {
    const recent = [...latestByUser.entries()];
    recentList.innerHTML = recent.length
      ? recent.map(([id, message]) => renderMessageContact(
        profilesById.get(id) || { id, username: 'usuario' },
        { preview: `${message.sender_id === userId ? 'Você: ' : ''}${message.body}` }
      )).join('')
      : '<div class="messages-hint">Nenhuma conversa ainda.</div>';
  }
  if (activeMessageRecipientId) await loadMessageThread(activeMessageRecipientId);
}

async function loadMessageThread(recipientId) {
  if (!supabaseClient || !currentUser || !recipientId) return;
  const recipient = messageProfilesById.get(recipientId) || { id: recipientId, username: 'usuario', display_name: 'Usuário' };
  const name = recipient.display_name || recipient.username || 'Usuário';
  const canSend = messageFollowerIds.has(recipientId);
  document.getElementById('messageEmptyState').hidden = true;
  document.getElementById('messageConversation').hidden = false;
  document.getElementById('messageRecipientName').textContent = name;
  document.getElementById('messageRecipientHandle').textContent = `@${recipient.username || 'usuario'}`;
  document.getElementById('messageRecipientAvatar').textContent = name.trim().slice(0, 2).toUpperCase() || 'U';
  const bodyInput = document.getElementById('messageBody');
  bodyInput.disabled = !canSend;
  bodyInput.placeholder = canSend ? 'Escreva sua mensagem...' : 'Esta pessoa precisa seguir você para receber mensagens.';
  document.getElementById('messageSendButton').disabled = !canSend;
  const thread = document.getElementById('messageThread');
  thread.innerHTML = '<div class="messages-hint">Carregando conversa…</div>';
  const userId = currentUser.id;
  const { data: messages, error } = await supabaseClient.from('direct_messages')
    .select('id,sender_id,recipient_id,body,created_at')
    .or(`and(sender_id.eq.${userId},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.error('load message thread:', error);
    thread.innerHTML = `<div class="messages-hint">Não foi possível carregar a conversa: ${escapeHtml(error.message)}.</div>`;
    return;
  }
  thread.innerHTML = messages?.length
    ? messages.map((message) => `<article class="message-bubble ${message.sender_id === userId ? 'mine' : 'theirs'}">${escapeHtml(message.body)}<time>${escapeHtml(new Date(message.created_at).toLocaleString('pt-BR'))}</time></article>`).join('')
    : '<div class="messages-hint">Ainda não há mensagens nesta conversa. Envie a primeira!</div>';
  thread.scrollTop = thread.scrollHeight;
}

async function toggleMessageFollow(button) {
  if (!supabaseClient || !currentUser) return;
  const targetId = button.dataset.followId;
  const currentlyFollowing = button.dataset.following === 'true';
  button.disabled = true;
  const request = currentlyFollowing
    ? supabaseClient.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', targetId)
    : supabaseClient.from('follows').insert({ follower_id: currentUser.id, following_id: targetId });
  const { error } = await request;
  button.disabled = false;
  if (error) {
    console.error('toggle follow:', error);
    showToast(`Não foi possível ${currentlyFollowing ? 'deixar de seguir' : 'seguir'}: ${error.message}`);
    return;
  }
  showToast(currentlyFollowing ? 'Você deixou de seguir este perfil' : 'Perfil seguido');
  await searchMessageProfiles();
  await refreshMessagesPage();
}

async function showFeed() {
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  if (adminPage) adminPage.hidden = true;
  contentWrap.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (currentUser) await loadRemoteFeed();
}

document.querySelectorAll('.explore-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const selected = tab.dataset.exploreTab;
    document.querySelectorAll('.explore-tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.explore-card').forEach((card) => {
      const category = card.classList.contains('explore-followers') ? 'followers' : card.classList.contains('explore-likes') ? 'likes' : card.classList.contains('explore-trending') ? 'trending' : 'sfc';
      card.classList.toggle('explore-hidden', selected !== 'all' && selected !== category);
    });
    document.querySelector('.explore-discovery').classList.toggle('explore-hidden', selected !== 'all');
  });
});
document.getElementById('exploreRefresh').addEventListener('click', loadExploreData);

function renderExploreAvatar(profile, className = 'avatar avatar-lime') {
  const name = profile.display_name || profile.username || 'Usuário';
  const avatar = profile.avatar_url
    ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" loading="lazy" />`
    : escapeHtml(name.trim().slice(0, 2).toUpperCase() || 'U');
  return `<div class="${className}">${avatar}</div>`;
}

function renderExplorePeople(profiles) {
  const container = document.getElementById('exploreFollowers');
  if (!profiles?.length) {
    container.innerHTML = '<div class="explore-empty">Ainda não há perfis para mostrar.</div>';
    return;
  }
  container.innerHTML = profiles.map((profile, index) => {
    const isSelf = profile.id === currentUser?.id;
    const isFollowing = exploreFollowIds.has(profile.id);
    const buttonText = isSelf ? 'Você' : !exploreFollowAvailable ? 'Indisponível' : isFollowing ? 'Seguindo' : 'Seguir';
    const disabled = isSelf || !exploreFollowAvailable;
    return `<div class="explore-person"><strong>${String(index + 1).padStart(2, '0')}</strong>${renderExploreAvatar(profile, 'avatar avatar-cyan')}<div><b>${escapeHtml(profile.display_name || profile.username)}</b><small>@${escapeHtml(profile.username || 'usuario')} · ${Number(profile.followers_count || 0).toLocaleString('pt-BR')} seguidores</small></div><button class="explore-follow-btn" type="button" data-explore-follow="${escapeHtml(profile.id)}" ${disabled ? 'disabled' : ''}>${buttonText}</button></div>`;
  }).join('');
}

function renderExploreLikes(posts) {
  const container = document.getElementById('exploreLikes');
  if (!posts?.length) {
    container.innerHTML = '<div class="explore-empty">Ainda não há publicações curtidas.</div>';
    return;
  }
  container.innerHTML = posts.map((post) => {
    const author = post.profiles || {};
    const title = post.body?.trim() || post.poll_question || (post.image_url ? 'Publicação com imagem' : 'Nova publicação');
    return `<article class="like-feature explore-post-link" tabindex="0" role="button" data-explore-post="${escapeHtml(post.id)}">${renderExploreAvatar(author, 'avatar avatar-lime')}<div><b>${escapeHtml(title.slice(0, 110))}</b><small>por ${escapeHtml(author.display_name || author.username || 'Usuário')} · ${Number(post.likes_count || 0).toLocaleString('pt-BR')} curtidas</small></div></article>`;
  }).join('');
}

function renderExploreTrending(posts) {
  const container = document.getElementById('exploreTrending');
  const topics = new Map();
  posts.forEach((post) => {
    const uniqueTags = new Set((post.body || '').match(/#[\p{L}\p{N}_]+/gu) || []);
    uniqueTags.forEach((tag) => {
      const key = tag.toLocaleLowerCase('pt-BR');
      topics.set(key, (topics.get(key) || 0) + 1);
    });
  });
  const entries = [...topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, 3);
  if (!entries.length) {
    container.innerHTML = '<div class="explore-empty">Nenhuma hashtag nas publicações das últimas 24 horas.</div>';
    return;
  }
  container.innerHTML = entries.map(([tag, count], index) => `<button class="trend-topic" type="button" data-explore-tag="${escapeHtml(tag)}"><span>${String(index + 1).padStart(2, '0')}</span><div><b>${escapeHtml(tag)}</b><small>${count.toLocaleString('pt-BR')} ${count === 1 ? 'publicação' : 'publicações'} nas últimas 24h</small></div></button>`).join('');
}

function renderExploreSfc(entries) {
  const container = document.getElementById('exploreSfc');
  if (!entries?.length) {
    container.innerHTML = '<div class="explore-empty">Ainda não há ganhos registrados nesta semana.</div>';
    return;
  }
  const maxEarnings = Math.max(...entries.map((entry) => Number(entry.earned_sfc || 0)), 0);
  container.innerHTML = entries.slice(0, 3).map((entry, index) => {
    const amount = Number(entry.earned_sfc || 0);
    const width = maxEarnings ? Math.max(4, (amount / maxEarnings) * 100) : 0;
    return `<div class="sfc-rank"><span>${String(index + 1).padStart(2, '0')}</span>${renderExploreAvatar(entry, 'avatar avatar-lime')}<div><b>${escapeHtml(entry.display_name || entry.username || 'Usuário')}</b><small>${amount.toFixed(6)} ${TOKEN} esta semana</small><div class="tiny-progress"><i style="width:${width}%"></i></div></div><strong>${amount.toFixed(6)}</strong></div>`;
  }).join('');
}

function renderExploreDiscovery(posts) {
  const container = document.getElementById('exploreDiscovery');
  if (!posts?.length) {
    container.innerHTML = '<div class="explore-empty">A comunidade ainda não publicou nada.</div>';
    return;
  }
  container.innerHTML = posts.map((post) => {
    const author = post.profiles || {};
    const body = post.body?.trim() || post.poll_question || (post.image_url ? 'Publicação com imagem' : 'Nova publicação');
    return `<article class="discovery-post explore-post-link" tabindex="0" role="button" data-explore-post="${escapeHtml(post.id)}">${renderExploreAvatar(author, 'avatar avatar-cyan')}<div><b>${escapeHtml(body.slice(0, 180))}</b><small>${escapeHtml(author.display_name || author.username || 'Usuário')} · ${new Date(post.created_at).toLocaleString('pt-BR')} · <span>+${Number(post.reward_sfc || 0).toFixed(6)} ${TOKEN}</span></small></div><strong>♡ ${Number(post.likes_count || 0).toLocaleString('pt-BR')}</strong></article>`;
  }).join('');
}

async function loadExploreData() {
  if (!supabaseClient) {
    ['exploreFollowers', 'exploreLikes', 'exploreTrending', 'exploreSfc', 'exploreDiscovery'].forEach((id) => {
      document.getElementById(id).innerHTML = '<div class="explore-empty">Configure o Supabase para carregar dados da comunidade.</div>';
    });
    return;
  }
  const requestId = ++exploreRequestId;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const postFields = 'id,author_id,body,image_url,poll_question,likes_count,reward_sfc,created_at,profiles!posts_author_id_fkey(display_name,username,avatar_url)';
  const [profilesResult, likedResult, trendingResult, earningsResult, discoveryResult, followsResult] = await Promise.all([
    supabaseClient.from('profiles').select('id,username,display_name,avatar_url,followers_count').order('followers_count', { ascending: false }).limit(3),
    supabaseClient.from('posts').select(postFields).order('likes_count', { ascending: false }).limit(2),
    supabaseClient.from('posts').select('body').gte('created_at', dayAgo).limit(1000),
    supabaseClient.rpc('weekly_earnings_leaderboard'),
    supabaseClient.from('posts').select(postFields).order('created_at', { ascending: false }).limit(3),
    currentUser ? supabaseClient.from('follows').select('following_id').eq('follower_id', currentUser.id) : Promise.resolve({ data: [], error: null })
  ]);
  if (requestId !== exploreRequestId) return;

  exploreFollowAvailable = !followsResult.error;
  if (followsResult.error) console.warn('Explore follows:', followsResult.error.message);
  const renderResult = (result, render, containerId, label) => {
    if (result.error) {
      console.error(`Explore ${label}:`, result.error);
      document.getElementById(containerId).innerHTML = '<div class="explore-empty">Não foi possível carregar estes dados. Tente atualizar.</div>';
      return;
    }
    render(result.data || []);
  };
  exploreFollowIds = new Set((followsResult.data || []).map((follow) => follow.following_id));
  renderResult(profilesResult, renderExplorePeople, 'exploreFollowers', 'perfis');
  renderResult(likedResult, renderExploreLikes, 'exploreLikes', 'publicações curtidas');
  renderResult(trendingResult, renderExploreTrending, 'exploreTrending', 'assuntos em alta');
  renderResult(earningsResult, renderExploreSfc, 'exploreSfc', 'ranking SFC');
  renderResult(discoveryResult, renderExploreDiscovery, 'exploreDiscovery', 'publicações recentes');
}

async function toggleExploreFollow(button) {
  if (!currentUser) {
    openAuth();
    return;
  }
  const targetId = button.dataset.exploreFollow;
  const isFollowing = exploreFollowIds.has(targetId);
  button.disabled = true;
  const request = isFollowing
    ? supabaseClient.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', targetId)
    : supabaseClient.from('follows').insert({ follower_id: currentUser.id, following_id: targetId });
  const { error } = await request;
  button.disabled = false;
  if (error) {
    console.error('Explore follow:', error);
    showToast('Não foi possível atualizar o perfil seguido. Verifique supabase-messages.sql.');
    return;
  }
  showToast(isFollowing ? 'Você deixou de seguir este perfil' : 'Você está seguindo este perfil');
  loadExploreData();
}

async function openExplorePost(postId) {
  await showFeed();
  const post = [...document.querySelectorAll('#feedPosts > .post')].find((item) => item.dataset.postId === postId);
  if (!post) {
    showToast('Esta publicação não está mais disponível');
    return;
  }
  post.scrollIntoView({ behavior: 'smooth', block: 'center' });
  post.classList.add('explore-post-highlight');
  setTimeout(() => post.classList.remove('explore-post-highlight'), 1800);
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.section === 'feed'));
}

function startExploreRealtime() {
  if (!supabaseClient || exploreRealtimeChannel) return;
  exploreRealtimeChannel = supabaseClient.channel('explore-live-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => {
      clearTimeout(window.exploreRefreshTimer);
      window.exploreRefreshTimer = setTimeout(loadExploreData, 350);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime do Explorar indisponível; atualização periódica continuará ativa.');
    });
  setInterval(loadExploreData, 60_000);
  window.addEventListener('focus', loadExploreData);
}

document.getElementById('explorePage').addEventListener('click', (event) => {
  const followButton = event.target.closest('[data-explore-follow]');
  if (followButton) {
    toggleExploreFollow(followButton);
    return;
  }
  const postItem = event.target.closest('[data-explore-post]');
  if (postItem) {
    openExplorePost(postItem.dataset.explorePost);
    return;
  }
  const tagButton = event.target.closest('[data-explore-tag]');
  if (tagButton) {
    showFeed();
    communitySearch.value = tagButton.dataset.exploreTag;
    runCommunitySearch();
  }
});

document.getElementById('explorePage').addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-explore-post]')) {
    event.preventDefault();
    openExplorePost(event.target.dataset.explorePost);
  }
});

async function syncProfilePage() {
  const saved = JSON.parse(localStorage.getItem('socfaucProfile') || 'null');
  const name = currentProfile?.display_name || saved?.name || currentUser?.user_metadata?.display_name || currentUser?.email?.split('@')[0] || 'Usuário socifauc';
  const handle = currentProfile?.username || saved?.handle || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'usuario';
  const bio = currentProfile?.bio ?? saved?.bio ?? '';
  document.getElementById('profilePageTitle').textContent = name;
  document.getElementById('profilePageHandle').textContent = `@${handle}`;
  document.getElementById('profilePageBio').textContent = bio;
  const profile = currentProfile || {};
  document.getElementById('profilePostsCount').textContent = '0';
  document.getElementById('profileFollowers').textContent = profile.followers_count || '0';
  document.getElementById('profileFollowing').textContent = profile.following_count || '0';
  document.getElementById('profileLikes').textContent = profile.likes_received || '0';
  const recentPosts = document.querySelector('.profile-recent');
  if (supabaseClient && currentUser) {
    const { data: posts, error } = await supabaseClient.from('posts').select('body,likes_count,comments_count,reward_sfc,created_at').eq('author_id', currentUser.id).order('created_at', { ascending: false }).limit(10);
    if (!error && posts) {
      const totalLikes = posts.reduce((sum, post) => sum + Number(post.likes_count || 0), 0);
      const totalRewards = posts.reduce((sum, post) => sum + Number(post.reward_sfc || 0), 0);
      document.getElementById('profilePostsCount').textContent = String(posts.length);
      document.getElementById('profileLikes').textContent = totalLikes.toLocaleString('pt-BR');
      recentPosts.innerHTML = `<div class="profile-section-title"><h2>Posts recentes</h2><span>${posts.length ? 'dados do Supabase' : 'ainda sem posts'}</span></div>${posts.length ? posts.map((post) => `<article class="profile-post"><div class="profile-post-meta"><span>${new Date(post.created_at).toLocaleDateString('pt-BR')}</span><b>+${Number(post.reward_sfc || 0).toFixed(6)} ${TOKEN}</b></div><p>${escapeHtml(post.body || '')}</p><div><span>♡ ${Number(post.likes_count || 0)} curtidas</span><span>◌ ${Number(post.comments_count || 0)} comentários</span></div></article>`).join('') : '<div class="feed-empty">Você ainda não publicou.</div>'}`;
      const postEarnings = document.querySelector('.profile-insight-card .lime-text');
      if (postEarnings) postEarnings.textContent = totalRewards.toFixed(6);
    }
  }
  const savedPhoto = localStorage.getItem('socfaucProfilePhoto');
  const pagePhoto = document.getElementById('profilePagePhoto');
  const photoUrl = currentProfile?.avatar_url || savedPhoto;
  if (photoUrl) applyAvatar(pagePhoto, name, photoUrl);
}

document.getElementById('profileBack').addEventListener('click', showFeed);
document.getElementById('walletBack').addEventListener('click', showFeed);
document.getElementById('messagesBack').addEventListener('click', showFeed);
document.getElementById('messagesRefresh').addEventListener('click', refreshMessagesPage);
document.getElementById('messageSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  searchMessageProfiles();
});
messagesPage.addEventListener('click', (event) => {
  const followButton = event.target.closest('.message-follow-button[data-follow-id]');
  if (followButton) {
    toggleMessageFollow(followButton);
    return;
  }
  const contactButton = event.target.closest('[data-message-user-id]');
  if (contactButton) {
    activeMessageRecipientId = contactButton.dataset.messageUserId;
    loadMessageThread(activeMessageRecipientId);
  }
});
document.getElementById('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const bodyInput = document.getElementById('messageBody');
  const body = bodyInput.value.trim();
  if (!supabaseClient || !currentUser || !activeMessageRecipientId || !body) return;
  if (!messageFollowerIds.has(activeMessageRecipientId)) {
    showToast('A pessoa precisa seguir você para receber mensagens');
    return;
  }
  const sendButton = document.getElementById('messageSendButton');
  sendButton.disabled = true;
  const { error } = await supabaseClient.from('direct_messages').insert({
    sender_id: currentUser.id,
    recipient_id: activeMessageRecipientId,
    body
  });
  sendButton.disabled = false;
  if (error) {
    console.error('send direct message:', error);
    showToast(`Não foi possível enviar: ${error.message}`);
    return;
  }
  bodyInput.value = '';
  await refreshMessagesPage();
  bodyInput.focus();
});
document.getElementById('notificationsBack').addEventListener('click', showFeed);
document.getElementById('markAllNotificationsRead').addEventListener('click', markAllNotificationsRead);
document.querySelectorAll('.notification-filter').forEach((button) => {
  button.addEventListener('click', () => {
    notificationFilter = button.dataset.notificationFilter;
    document.querySelectorAll('.notification-filter').forEach((filterButton) => filterButton.classList.toggle('active', filterButton === button));
    loadNotifications();
  });
});
notificationsPage.addEventListener('click', (event) => {
  const item = event.target.closest('.notification-item[data-notification-id]');
  if (!item) return;
  openNotification({
    notificationId: item.dataset.notificationId,
    type: item.dataset.notificationType,
    actorId: item.dataset.actorId,
    postId: item.dataset.postId
  });
});
document.getElementById('editProfilePage').addEventListener('click', () => {
  openProfile();
});

function openProfile() {
  profileModal.classList.add('open');
  profileModal.style.opacity = '1';
  profileModal.style.visibility = 'visible';
  profileModal.setAttribute('aria-hidden', 'false');
  document.getElementById('profileName').focus();
}

function closeProfile() {
  profileModal.classList.remove('open');
  profileModal.style.opacity = '0';
  profileModal.style.visibility = 'hidden';
  profileModal.setAttribute('aria-hidden', 'true');
}

document.getElementById('closeProfile').addEventListener('click', closeProfile);
profileModal.addEventListener('click', (event) => {
  if (event.target === profileModal) closeProfile();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && profileModal.classList.contains('open')) closeProfile();
});

const profileUpload = document.getElementById('profileUpload');
profileUpload.addEventListener('change', async () => {
  const [file] = profileUpload.files;
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showToast('Escolha uma imagem PNG, JPG ou WEBP de até 5 MB');
    profileUpload.value = '';
    return;
  }
  if (!supabaseClient || !currentUser) {
    showToast('Entre na sua conta para salvar sua foto de perfil');
    profileUpload.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    applyAvatar(profilePhoto, currentProfile?.display_name, reader.result);
  });
  reader.readAsDataURL(file);
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const objectPath = `${currentUser.id}/${Date.now()}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage.from('profile-avatars').upload(objectPath, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false
  });
  if (uploadError) {
    console.error('profile avatar upload:', uploadError);
    applyCurrentProfileIdentity();
    showToast(`Não foi possível enviar a foto: ${uploadError.message}. Confira supabase-profile-avatars.sql.`);
    return;
  }
  const { data: publicUrl } = supabaseClient.storage.from('profile-avatars').getPublicUrl(objectPath);
  const avatarUrl = publicUrl.publicUrl;
  const { error: profileError } = await supabaseClient.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
  if (profileError) {
    console.error('save profile avatar URL:', profileError);
    showToast(`Foto enviada, mas o perfil não foi atualizado: ${profileError.message}`);
    return;
  }
  currentProfile = { ...(currentProfile || {}), avatar_url: avatarUrl };
  localStorage.setItem('socfaucProfilePhoto', avatarUrl);
  applyCurrentProfileIdentity();
  showToast('Foto de perfil atualizada');
});

const profileBio = document.getElementById('profileBio');
const bioCount = document.getElementById('bioCount');
profileBio.addEventListener('input', () => { bioCount.textContent = `${profileBio.value.length}/160`; });
document.getElementById('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('profileName').value.trim() || currentUser?.email?.split('@')[0] || 'Usuário';
  const handle = document.getElementById('profileHandle').value.trim() || currentUser?.email?.split('@')[0] || 'usuario';
  const bio = profileBio.value.trim();
  currentProfile = { ...(currentProfile || {}), display_name: name, username: handle, bio, age: Number(document.getElementById('profileAge').value) || null };
  localStorage.setItem('socfaucProfile', JSON.stringify({ name, handle, age: document.getElementById('profileAge').value, bio }));
  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, username: handle, display_name: name, age: Number(document.getElementById('profileAge').value) || null, bio }, { onConflict: 'id' });
    if (error) { showToast(`Não foi possível salvar o perfil: ${error.message}`); return; }
  }
  document.querySelector('.profile-mini strong').textContent = name;
  document.querySelector('.profile-mini small').textContent = `@${handle}`;
  applyCurrentProfileIdentity();
  syncProfilePage();
  closeProfile();
  showToast('Perfil atualizado com sucesso');
});

const savedPhoto = localStorage.getItem('socfaucProfilePhoto');
if (savedPhoto) applyAvatar(profilePhoto, 'Usuário', savedPhoto);
const savedProfile = JSON.parse(localStorage.getItem('socfaucProfile') || 'null');
if (savedProfile) {
  document.getElementById('profileName').value = savedProfile.name || '';
  document.getElementById('profileHandle').value = savedProfile.handle || '';
  document.getElementById('profileAge').value = savedProfile.age || '';
  profileBio.value = savedProfile.bio || '';
  bioCount.textContent = `${profileBio.value.length}/160`;
  document.querySelector('.profile-mini strong').textContent = savedProfile.name || 'Marina Costa';
  document.querySelector('.profile-mini small').textContent = `@${savedProfile.handle || 'marinac'}`;
}

const postInput = document.getElementById('postInput');
const charCount = document.getElementById('charCount');
const photoInput = document.getElementById('photoInput');
const composerAttachment = document.getElementById('composerAttachment');
const pollBuilder = document.getElementById('pollBuilder');
let pendingImage = '';
postInput.addEventListener('input', () => {
  if (postInput.value.length > 280) postInput.value = postInput.value.slice(0, 280);
  charCount.textContent = `${postInput.value.length}/280`;
});

document.getElementById('photoTool').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const [file] = photoInput.files;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('A foto precisa ter até 5 MB');
    photoInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    pendingImage = reader.result;
    composerAttachment.innerHTML = `<img src="${pendingImage}" alt="Preview da foto selecionada" /><button class="remove-attachment" type="button" aria-label="Remover foto">×</button>`;
    composerAttachment.classList.add('visible');
    composerAttachment.querySelector('.remove-attachment').addEventListener('click', clearPendingImage);
  });
  reader.readAsDataURL(file);
});

function clearPendingImage() {
  pendingImage = '';
  photoInput.value = '';
  composerAttachment.innerHTML = '';
  composerAttachment.classList.remove('visible');
}

document.getElementById('pollTool').addEventListener('click', () => {
  pollBuilder.classList.toggle('visible');
  if (pollBuilder.classList.contains('visible')) document.getElementById('pollQuestion').focus();
});
document.getElementById('closePollBuilder').addEventListener('click', () => pollBuilder.classList.remove('visible'));
document.getElementById('addPollOption').addEventListener('click', () => {
  const options = document.querySelectorAll('.poll-input');
  if (options.length >= 4) {
    showToast('Uma enquete pode ter até 4 opções');
    return;
  }
  const option = document.createElement('input');
  option.className = 'poll-input';
  option.type = 'text';
  option.maxLength = 70;
  option.placeholder = `Opção ${options.length + 1}`;
  document.getElementById('pollOptions').appendChild(option);
});

document.getElementById('publishBtn').addEventListener('click', async () => {
  if (supabaseClient && !currentUser) {
    openAuth();
    showToast('Entre para publicar na comunidade');
    return;
  }
  const text = postInput.value.trim();
  const pollQuestion = document.getElementById('pollQuestion').value.trim();
  const pollOptions = [...document.querySelectorAll('.poll-input')].map((input) => input.value.trim()).filter(Boolean);
  if (!text && !pendingImage && !pollQuestion) {
    showToast('Adicione texto, foto ou enquete antes de publicar');
    postInput.focus();
    return;
  }
  if (state.energy < 1) {
    showToast('Energia insuficiente. Converta SFC em energia para publicar.');
    return;
  }
  state.energy -= 1;
  updateEnergyDisplay();
  let remotePost = null;
  if (supabaseClient && currentUser) {
    const result = await supabaseClient.from('posts').insert({
      author_id: currentUser.id,
      body: text,
      image_url: pendingImage || null,
      poll_question: pollQuestion || null,
      poll_options: pollQuestion ? pollOptions : null,
      reward_sfc: Number(rewardSettings.post_reward)
    }).select('id').single();
    if (result.error) {
      state.energy += 1;
      updateEnergyDisplay();
      showToast('Não foi possível salvar o post no Supabase');
      console.error('Supabase post:', result.error);
      return;
    }
    remotePost = result.data;
  }
  const authorName = currentProfile?.display_name || currentUser?.user_metadata?.display_name || currentUser?.email?.split('@')[0] || 'Usuário';
  const authorHandle = currentProfile?.username || currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'usuario';
  const authorAvatar = currentProfile?.avatar_url || localStorage.getItem('socfaucProfilePhoto') || '';
  const avatarStyle = authorAvatar ? ` style="background-image:url('${escapeHtml(authorAvatar)}');background-size:cover;background-position:center;color:transparent"` : '';
  const avatarInitials = escapeHtml(authorName.trim().slice(0, 2).toUpperCase() || 'U');
  const safeText = escapeHtml(text);
  const imageMarkup = pendingImage ? `<div class="post-uploaded-image"><img src="${escapeHtml(pendingImage)}" alt="Imagem publicada por ${escapeHtml(authorName)}" /></div>` : '';
  const pollMarkup = pollQuestion ? `<div class="poll"><div class="poll-head"><span>${pollQuestion.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</span><strong>0 votos</strong></div>${pollOptions.map((option) => `<button class="poll-option" type="button"><span>${option.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))}</span><b>0%</b><i style="width:0%"></i></button>`).join('')}</div>` : '';
  const article = document.createElement('article');
  article.className = 'post panel';
  article.dataset.postId = remotePost?.id || `post-${Date.now()}`;
  article.dataset.authorId = currentUser?.id || '';
  article.innerHTML = `<div class="post-author"><div class="avatar avatar-lime"${avatarStyle}>${authorAvatar ? '' : avatarInitials}</div><div><strong>${escapeHtml(authorName)} <i>✓</i></strong><small>@${escapeHtml(authorHandle)} · agora</small></div><button class="post-more">•••</button></div>${safeText ? `<p>${safeText}</p>` : ''}${imageMarkup}${pollMarkup}<div class="post-stats"><span>0 comentários</span><span>agora</span><span class="earned">+${Number(rewardSettings.post_reward).toFixed(6)} ${TOKEN}</span></div><div class="post-actions"><button class="like-btn">♡ <span>0</span></button><button class="comment-btn">◌ <span>0</span></button><button>↗ <span>Repostar</span></button><button class="tip-btn">S <span>Dar gorjeta</span></button></div>`;
  document.getElementById('feedPosts').prepend(article);
  runCommunitySearch();
  if (remotePost) await loadUserData(currentUser);
  else updateBalance(Number(rewardSettings.post_reward));
  postInput.value = '';
  charCount.textContent = '0/280';
  clearPendingImage();
  pollBuilder.classList.remove('visible');
  document.getElementById('pollQuestion').value = '';
  document.getElementById('pollOptions').innerHTML = '<input class="poll-input" type="text" maxlength="70" placeholder="Opção 1" /><input class="poll-input" type="text" maxlength="70" placeholder="Opção 2" />';
  showToast(`+${Number(rewardSettings.post_reward).toFixed(6)} ${TOKEN} por criar um post original`);
  article.querySelector('.tip-btn').addEventListener('click', () => openTipModal(article.querySelector('.tip-btn')));
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    showToast(`${tab.textContent} selecionado`);
  });
});

function renderRemotePost(post) {
  const author = post.profiles || {};
  const name = escapeHtml(author.display_name || author.username || 'Usuário socifauc');
  const handle = escapeHtml(author.username || 'usuario');
  const avatarUrl = author.avatar_url || '';
  const avatarStyle = avatarUrl ? ` style="background-image:url('${escapeHtml(avatarUrl)}');background-size:cover;background-position:center;color:transparent"` : '';
  const initials = escapeHtml((author.display_name || author.username || 'U').trim().slice(0, 2).toUpperCase() || 'U');
  const body = escapeHtml(post.body || '');
  const image = post.image_url ? `<div class="post-uploaded-image"><img src="${escapeHtml(post.image_url)}" alt="Imagem publicada por ${name}" /></div>` : '';
  const poll = post.poll_question ? `<div class="poll"><div class="poll-head"><span>${escapeHtml(post.poll_question)}</span><strong>0 votos</strong></div>${(post.poll_options || []).map((option) => `<button class="poll-option" type="button"><span>${escapeHtml(option)}</span><b>0%</b><i style="width:0%"></i></button>`).join('')}</div>` : '';
  const article = document.createElement('article');
  article.className = 'post panel';
  article.dataset.postId = post.id;
  article.dataset.authorId = post.author_id;
  article.innerHTML = `<div class="post-author"><div class="avatar avatar-lime"${avatarStyle}>${avatarUrl ? '' : initials}</div><div><strong>${name} <i>✓</i></strong><small>@${handle} · ${new Date(post.created_at).toLocaleDateString('pt-BR')}</small></div><button class="post-more">•••</button></div>${body ? `<p>${body}</p>` : ''}${image}${poll}<div class="post-stats"><span>${post.comments_count || 0} comentários</span><span>${post.likes_count || 0} curtidas</span><span class="earned">+${Number(post.reward_sfc || 0).toFixed(6)} ${TOKEN}</span></div><div class="post-actions"><button class="like-btn">♡ <span>${post.likes_count || 0}</span></button><button class="comment-btn">◌ <span>${post.comments_count || 0}</span></button><button>↗ <span>Repostar</span></button><button class="tip-btn">S <span>Dar gorjeta</span></button></div>`;
  return article;
}

function renderSponsoredPost(campaign) {
  const article = renderRemotePost({
    id: campaign.post_id,
    author_id: campaign.author_id,
    body: campaign.body,
    image_url: campaign.image_url,
    poll_question: campaign.poll_question,
    poll_options: campaign.poll_options,
    likes_count: campaign.likes_count,
    comments_count: campaign.comments_count,
    reposts_count: campaign.reposts_count,
    reward_sfc: campaign.reward_sfc,
    created_at: campaign.created_at,
    profiles: { display_name: campaign.display_name, username: campaign.username, avatar_url: campaign.avatar_url }
  });
  article.classList.add('sponsored-post');
  article.dataset.adCampaignId = campaign.campaign_id;
  const label = document.createElement('span');
  label.className = 'sponsored-label';
  label.textContent = 'Patrocinado';
  article.prepend(label);
  return article;
}

async function recordSponsoredPostEvent(campaignId, eventType) {
  if (!supabaseClient || !currentUser || !campaignId) return;
  const { error } = await supabaseClient.rpc('record_ad_event', {
    p_campaign_id: campaignId,
    p_event_type: eventType
  });
  if (error) console.warn('ad event:', error.message);
}

function observeSponsoredPostImpressions() {
  if (adImpressionObserver) adImpressionObserver.disconnect();
  if (!currentUser || !('IntersectionObserver' in window)) return;
  adImpressionObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
      observer.unobserve(entry.target);
      recordSponsoredPostEvent(entry.target.dataset.adCampaignId, 'impression');
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('#feedPosts .sponsored-post[data-ad-campaign-id]').forEach((post) => adImpressionObserver.observe(post));
}

function renderWeeklyLeaderboard() {
  const container = document.getElementById('weeklyLeaderboard');
  const moreButton = document.getElementById('weeklyLeaderboardMore');
  if (!weeklyLeaderboardEntries.length) {
    container.innerHTML = '<div class="leaderboard-empty">Ainda não há ganhos registrados nos últimos 7 dias.</div>';
    moreButton.hidden = true;
    return;
  }
  const entries = weeklyLeaderboardExpanded ? weeklyLeaderboardEntries : weeklyLeaderboardEntries.slice(0, 3);
  container.innerHTML = entries.map((entry, index) => {
    const name = entry.display_name || entry.username || 'Usuário';
    const username = entry.username || 'usuario';
    const initials = name.trim().slice(0, 2).toUpperCase() || 'U';
    const avatar = entry.avatar_url
      ? `<div class="avatar leader-avatar"><img src="${escapeHtml(entry.avatar_url)}" alt="" loading="lazy" /></div>`
      : `<div class="avatar avatar-lime leader-avatar">${escapeHtml(initials)}</div>`;
    const earnings = Number(entry.earned_sfc || 0).toFixed(6);
    return `<div class="leader"><b>${String(index + 1).padStart(2, '0')}</b>${avatar}<div class="leader-name"><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(username)}</small></div><span>${earnings} <small>${TOKEN}</small></span></div>`;
  }).join('');
  moreButton.hidden = weeklyLeaderboardEntries.length <= 3;
  moreButton.textContent = weeklyLeaderboardExpanded ? 'Ver top 3' : 'Ver ranking';
}

async function loadWeeklyLeaderboard() {
  const container = document.getElementById('weeklyLeaderboard');
  if (!supabaseClient) {
    container.innerHTML = '<div class="leaderboard-empty">Configure o Supabase para carregar o ranking.</div>';
    return;
  }
  const requestId = ++weeklyLeaderboardRequestId;
  const { data, error } = await supabaseClient.rpc('weekly_earnings_leaderboard');
  if (requestId !== weeklyLeaderboardRequestId) return;
  if (error) {
    console.error('weekly leaderboard:', error);
    container.innerHTML = `<div class="leaderboard-empty">Não foi possível carregar: ${escapeHtml(error.message)}. Execute supabase-leaderboard.sql.</div>`;
    document.getElementById('weeklyLeaderboardMore').hidden = true;
    return;
  }
  weeklyLeaderboardEntries = data || [];
  if (weeklyLeaderboardExpanded && weeklyLeaderboardEntries.length <= 3) weeklyLeaderboardExpanded = false;
  renderWeeklyLeaderboard();
}

function startWeeklyLeaderboardRealtime() {
  if (!supabaseClient || weeklyLeaderboardChannel) return;
  weeklyLeaderboardChannel = supabaseClient.channel('weekly-earnings-leaderboard')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leaderboard_signal' }, () => {
      clearTimeout(weeklyLeaderboardRefreshTimer);
      weeklyLeaderboardRefreshTimer = setTimeout(loadWeeklyLeaderboard, 300);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn('Realtime do ranking indisponível; atualização periódica continuará ativa.');
    });
  setInterval(loadWeeklyLeaderboard, 60_000);
  window.addEventListener('focus', loadWeeklyLeaderboard);
}

document.getElementById('weeklyLeaderboardMore').addEventListener('click', () => {
  weeklyLeaderboardExpanded = !weeklyLeaderboardExpanded;
  renderWeeklyLeaderboard();
});

async function loadRemoteFeed() {
  if (!supabaseClient) return;
  const feed = document.getElementById('feedPosts');
  feed.innerHTML = '<div class="feed-empty">Carregando publicações da comunidade...</div>';
  const { data, error } = await supabaseClient.from('posts').select('id,author_id,body,image_url,poll_question,poll_options,likes_count,comments_count,reposts_count,reward_sfc,created_at,profiles!posts_author_id_fkey(display_name,username,avatar_url)').order('created_at', { ascending: false });
  if (error) {
    feed.innerHTML = `<div class="feed-empty">Não foi possível carregar o feed. Execute o arquivo supabase-schema.sql no Supabase.</div>`;
    console.error('Supabase posts:', error);
    return;
  }
  feed.innerHTML = '';
  if (!data.length) {
    feed.innerHTML = '<div class="feed-empty">Ainda não há publicações. Seja o primeiro a postar.</div>';
    return;
  }
  const adSlots = currentUser ? Math.floor(data.length / 6) : 0;
  let sponsoredCampaigns = [];
  if (adSlots) {
    const { data: campaigns, error: campaignError } = await supabaseClient.rpc('get_feed_ad_campaigns', { p_limit: adSlots });
    if (campaignError) console.warn('feed ads:', campaignError.message);
    else sponsoredCampaigns = campaigns || [];
  }
  let campaignIndex = 0;
  data.forEach((post, index) => {
    feed.appendChild(renderRemotePost(post));
    if ((index + 1) % 6 === 0 && sponsoredCampaigns[campaignIndex]) {
      feed.appendChild(renderSponsoredPost(sponsoredCampaigns[campaignIndex]));
      campaignIndex += 1;
    }
  });
  observeSponsoredPostImpressions();
  runCommunitySearch();
}

loadRemoteFeed();
loadWeeklyLeaderboard();
startWeeklyLeaderboardRealtime();
applyRewardSettings();
loadRewardSettings();
startRewardSettingsRealtime();

function showAdminPage() {
  if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    showToast('Acesso restrito ao administrador');
    return;
  }
  contentWrap.style.display = 'none';
  profilePage.classList.remove('visible');
  walletPage.classList.remove('visible');
  explorePage.classList.remove('visible');
  advertisingPage.classList.remove('visible');
  messagesPage.classList.remove('visible');
  notificationsPage.classList.remove('visible');
  adminPage.hidden = false;
  document.getElementById('adminLoggedEmail').textContent = currentUser.email;
  loadRewardSettings();
  loadAdminData();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let adminCurrentFilter = 'pending';

function utcDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function loadAdminData() {
  if (!supabaseClient) {
    document.getElementById('adminWithdrawalsList').innerHTML = '<div class="admin-empty">Configure o Supabase para usar o painel admin.</div>';
    return;
  }
  const days = Number(document.getElementById('adminChartRange').value) || 14;
  const rangeStart = utcDay(-(days - 1));
  const weekStart = utcDay(-6);
  const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const sevenDaysIso = new Date(Date.now() - 7 * 86400000).toISOString();
  const statsBox = document.getElementById('adminStats');
  statsBox.classList.add('loading');
  const [
    usersAll, usersNew7, dauToday, dauYesterday, dauWeek, dauRange,
    postsAll, postsToday, postsRange, commentsAll, likesAll, repostsAll,
    tipsAll, walletsAll, withdrawalsAll, profilesRange
  ] = await Promise.all([
    supabaseClient.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysIso),
    supabaseClient.from('daily_active_users').select('*', { count: 'exact', head: true }).eq('day', utcDay(0)),
    supabaseClient.from('daily_active_users').select('*', { count: 'exact', head: true }).eq('day', utcDay(-1)),
    supabaseClient.from('daily_active_users').select('user_id').gte('day', weekStart),
    supabaseClient.from('daily_active_users').select('day').gte('day', rangeStart),
    supabaseClient.from('posts').select('*', { count: 'exact', head: true }),
    supabaseClient.from('posts').select('*', { count: 'exact', head: true }).gte('created_at', todayStartIso),
    supabaseClient.from('posts').select('created_at').gte('created_at', rangeStart + 'T00:00:00Z'),
    supabaseClient.from('comments').select('*', { count: 'exact', head: true }),
    supabaseClient.from('post_likes').select('*', { count: 'exact', head: true }),
    supabaseClient.from('reposts').select('*', { count: 'exact', head: true }),
    supabaseClient.from('tips').select('amount_sfc'),
    supabaseClient.from('wallets').select('sfc_balance'),
    supabaseClient.from('withdrawals').select('amount_sfc,status'),
    supabaseClient.from('profiles').select('created_at').gte('created_at', rangeStart + 'T00:00:00Z')
  ]);
  statsBox.classList.remove('loading');
  const denied = [usersAll, withdrawalsAll, walletsAll].find((r) => r.error);
  if (denied) {
    console.error('admin stats:', denied.error);
    showToast('Sem permissão admin ou SQL não executado. Rode supabase-admin.sql.');
    return;
  }
  const count = (r) => r.count ?? 0;
  const sum = (rows, field) => (rows || []).reduce((acc, row) => acc + Number(row[field] || 0), 0);
  const uniqueWeek = new Set((dauWeek.data || []).map((r) => r.user_id)).size;
  const pendingRows = (withdrawalsAll.data || []).filter((w) => w.status === 'pending');
  const approvedAmount = (withdrawalsAll.data || []).filter((w) => w.status === 'approved' || w.status === 'paid').reduce((a, w) => a + Number(w.amount_sfc), 0);
  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
  const fmtSfc = (n) => Number(n || 0).toFixed(6);
  document.getElementById('statTotalUsers').textContent = fmt(count(usersAll));
  document.getElementById('statNewUsers7d').textContent = `+${fmt(count(usersNew7))} nos últimos 7 dias`;
  document.getElementById('statUsersToday').textContent = fmt(count(dauToday));
  document.getElementById('statUsersYesterday').textContent = `ontem: ${fmt(count(dauYesterday))}`;
  document.getElementById('statUsers7d').textContent = fmt(uniqueWeek);
  document.getElementById('statTotalPosts').textContent = fmt(count(postsAll));
  document.getElementById('statPostsToday').textContent = `hoje: ${fmt(count(postsToday))}`;
  document.getElementById('statTotalComments').textContent = fmt(count(commentsAll));
  document.getElementById('statTotalLikes').textContent = fmt(count(likesAll));
  document.getElementById('statTotalReposts').textContent = `reposts: ${fmt(count(repostsAll))}`;
  document.getElementById('statTotalTips').textContent = fmtSfc(sum(tipsAll.data, 'amount_sfc'));
  document.getElementById('statTotalTipsCount').textContent = `${fmt((tipsAll.data || []).length)} transações`;
  document.getElementById('statSfcCirculation').textContent = fmtSfc(sum(walletsAll.data, 'sfc_balance'));
  document.getElementById('statPendingCount').textContent = fmt(pendingRows.length);
  document.getElementById('statPendingAmount').textContent = `${fmtSfc(pendingRows.reduce((a, w) => a + Number(w.amount_sfc), 0))} SFC`;
  document.getElementById('statApprovedAmount').textContent = fmtSfc(approvedAmount);

  renderAdminChart(buildAdminSeries(days, dauRange.data, profilesRange.data, postsRange.data));
  loadAdminWithdrawals();
}

function buildAdminSeries(days, dauRows, profileRows, postRows) {
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(-i);
    series.push({
      day,
      active_users: (dauRows || []).filter((r) => r.day === day).length,
      new_users: (profileRows || []).filter((r) => (r.created_at || '').slice(0, 10) === day).length,
      posts: (postRows || []).filter((r) => (r.created_at || '').slice(0, 10) === day).length
    });
  }
  return series;
}

async function loadAdminWithdrawals() {
  const container = document.getElementById('adminWithdrawalsList');
  container.innerHTML = '<div class="admin-empty">Carregando saques…</div>';
  let query = supabaseClient.from('withdrawals')
    .select('id,user_id,polygon_wallet,amount_sfc,status,note,tx_hash,created_at,reviewed_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (adminCurrentFilter !== 'all') query = query.eq('status', adminCurrentFilter);
  const { data: withdrawals, error } = await query;
  if (error) {
    console.error('admin withdrawals:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
    container.innerHTML = `<div class="admin-empty">Erro ao carregar saques: ${escapeHtml(error.message || 'falha na consulta')}.</div>`;
    return;
  }

  const rows = withdrawals || [];
  const userIds = [...new Set(rows.map((withdrawal) => withdrawal.user_id).filter(Boolean))];
  let profiles = [];
  let wallets = [];
  if (userIds.length) {
    const [profilesResult, walletsResult] = await Promise.all([
      supabaseClient.from('profiles').select('id,username,display_name').in('id', userIds),
      supabaseClient.from('wallets').select('user_id,sfc_balance').in('user_id', userIds)
    ]);
    if (profilesResult.error) console.warn('admin withdrawal profiles:', profilesResult.error);
    else profiles = profilesResult.data || [];
    if (walletsResult.error) console.warn('admin withdrawal wallets:', walletsResult.error);
    else wallets = walletsResult.data || [];
  }

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const walletsByUserId = new Map(wallets.map((wallet) => [wallet.user_id, wallet]));
  renderAdminWithdrawals(rows.map((withdrawal) => {
    const profile = profilesById.get(withdrawal.user_id);
    const wallet = walletsByUserId.get(withdrawal.user_id);
    return {
      ...withdrawal,
      username: profile?.username,
      display_name: profile?.display_name,
      user_balance: wallet?.sfc_balance ?? 0
    };
  }));
}

function renderAdminChart(rows) {
  const container = document.getElementById('adminBars');
  if (!rows.length) { container.innerHTML = '<div class="admin-empty">Sem dados ainda.</div>'; return; }
  const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.active_users), Number(r.new_users), Number(r.posts))));
  container.innerHTML = rows.map((r) => {
    const dayStr = typeof r.day === 'string' ? r.day : new Date(r.day).toISOString().slice(0, 10);
    const d = new Date(dayStr + 'T00:00:00Z');
    const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const a = (Number(r.active_users) / max) * 100;
    const n = (Number(r.new_users) / max) * 100;
    const p = (Number(r.posts) / max) * 100;
    return `<div class="admin-bar-col" title="${label}: ${r.active_users} ativos · ${r.new_users} novos · ${r.posts} posts"><div class="admin-bar-group"><i class="bar-active" style="height:${a}%"></i><i class="bar-new" style="height:${n}%"></i><i class="bar-posts" style="height:${p}%"></i></div><small>${label}</small></div>`;
  }).join('');
}

function renderAdminWithdrawals(rows) {
  const container = document.getElementById('adminWithdrawalsList');
  if (!rows.length) { container.innerHTML = '<div class="admin-empty">Nenhum saque nesta visão.</div>'; return; }
  container.innerHTML = rows.map((w) => {
    const date = new Date(w.created_at).toLocaleString('pt-BR');
    const wallet = String(w.polygon_wallet || '');
    const short = wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : 'Não informada';
    const balance = Number(w.user_balance || 0).toFixed(6);
    const status = w.status;
    const statusLabel = { pending: 'Pendente', approved: 'Aprovado', paid: 'Pago', rejected: 'Rejeitado' }[status] || status;
    const displayName = w.display_name || w.username || 'Usuário';
    const username = w.username || 'usuario';
    const actions = status === 'pending'
      ? `<button class="admin-action approve" data-id="${w.id}" data-action="approved">Aprovar</button><button class="admin-action paid" data-id="${w.id}" data-action="paid">Marcar pago</button><button class="admin-action reject" data-id="${w.id}" data-action="rejected">Rejeitar</button>`
      : status === 'approved'
        ? `<button class="admin-action paid" data-id="${w.id}" data-action="paid">Marcar pago</button><button class="admin-action reject" data-id="${w.id}" data-action="rejected">Rejeitar</button>`
        : '';
    return `<article class="admin-withdrawal" data-status="${status}">
      <div class="aw-main">
        <div class="aw-user"><div class="avatar avatar-lime">${escapeHtml(displayName.slice(0, 2).toUpperCase())}</div><div><strong>${escapeHtml(displayName)}</strong><small>@${escapeHtml(username)} · saldo ${escapeHtml(balance)} SFC</small></div></div>
        <div class="aw-wallet"><span>Carteira Polygon</span><b title="${escapeHtml(wallet)}">${escapeHtml(short)}</b><button class="admin-action paid copy-wallet" type="button" data-wallet="${escapeHtml(wallet)}" ${wallet ? '' : 'disabled'}>Copiar</button></div>
        <div class="aw-amount"><span>Valor</span><b>${Number(w.amount_sfc).toFixed(6)} SFC</b></div>
        <div class="aw-date"><span>Criado</span><b>${date}</b></div>
        <div class="aw-status status-${escapeHtml(status)}">${escapeHtml(statusLabel)}</div>
      </div>
      ${w.note ? `<div class="aw-note">Nota: ${escapeHtml(w.note)}</div>` : ''}
      ${actions ? `<div class="aw-actions">${actions}</div>` : ''}
    </article>`;
  }).join('');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('cópia não suportada neste navegador');
}

document.getElementById('adminBack').addEventListener('click', showFeed);
document.getElementById('adminRefresh').addEventListener('click', loadAdminData);
document.getElementById('adminRewardSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('adminRewardSettingsStatus');
  const form = event.currentTarget;
  if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    status.dataset.state = 'error';
    status.textContent = 'Somente o administrador pode alterar estes valores.';
    return;
  }
  if (!form.reportValidity()) return;
  const values = {
    post_reward: Number(document.getElementById('rewardPost').value),
    like_reward: Number(document.getElementById('rewardLike').value),
    comment_reward: Number(document.getElementById('rewardComment').value),
    repost_reward: Number(document.getElementById('rewardRepost').value),
    story_reward: Number(document.getElementById('rewardStory').value),
    mission_post_reward: Number(document.getElementById('missionPostReward').value),
    mission_video_reward: Number(document.getElementById('missionVideoReward').value),
    mission_engagement_reward: Number(document.getElementById('missionEngagementReward').value),
    mission_engagement_goal: Number(document.getElementById('missionEngagementGoal').value),
    ad_cpm_sfc: Number(document.getElementById('adCpmSfc').value),
    updated_at: new Date().toISOString()
  };
  const saveButton = document.getElementById('adminRewardSettingsSave');
  saveButton.disabled = true;
  status.dataset.state = '';
  status.textContent = 'Salvando…';
  const { data, error } = await supabaseClient.from('reward_settings')
    .update(values).eq('id', true).select('*').single();
  saveButton.disabled = false;
  if (error) {
    console.error('save reward settings:', error);
    status.dataset.state = 'error';
    status.textContent = `Não foi possível salvar: ${error.message}. Execute supabase-rewards.sql e supabase-ads.sql.`;
    return;
  }
  rewardSettings = { ...rewardSettings, ...data };
  applyRewardSettings();
  status.dataset.state = 'success';
  status.textContent = 'Recompensas e missões atualizadas.';
  showToast('Configurações de recompensa salvas');
});
document.getElementById('adminChartRange').addEventListener('change', loadAdminData);
document.querySelectorAll('.admin-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    adminCurrentFilter = btn.dataset.status;
    loadAdminWithdrawals();
  });
});
document.getElementById('adminWithdrawalsList').addEventListener('click', async (event) => {
  const copyButton = event.target.closest('.copy-wallet');
  if (copyButton) {
    try {
      await copyTextToClipboard(copyButton.dataset.wallet || '');
      showToast('Carteira copiada');
    } catch (error) {
      console.error('copy withdrawal wallet:', error);
      showToast('Não foi possível copiar a carteira');
    }
    return;
  }
  const btn = event.target.closest('.admin-action');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  let note = '';
  if (action === 'rejected') {
    const reason = window.prompt('Motivo da rejeição (opcional):');
    if (reason === null) return;
    note = reason;
  }
  let txHash = null;
  if (action === 'paid') {
    txHash = window.prompt('Hash da transação (opcional):') || null;
    if (txHash === null) return;
  }
  btn.disabled = true;
  const error = await reviewWithdrawal(id, action, note, txHash);
  btn.disabled = false;
  if (error) { showToast('Erro: ' + error); return; }
  showToast(`Saque ${action === 'rejected' ? 'rejeitado' : action === 'paid' ? 'marcado como pago' : 'aprovado'}`);
  loadAdminData();
});

async function reviewWithdrawal(id, newStatus, note, txHash) {
  const { data: w, error: fetchError } = await supabaseClient.from('withdrawals').select('*').eq('id', id).maybeSingle();
  if (fetchError) return fetchError.message;
  if (!w) return 'saque não encontrado';
  const allowed = (w.status === 'pending') || (w.status === 'approved' && newStatus === 'paid');
  if (!allowed) return `não é possível mudar de "${w.status}" para "${newStatus}"`;
  const { error: updateError } = await supabaseClient.from('withdrawals').update({
    status: newStatus,
    note: newStatus === 'paid' ? w.note : note,
    tx_hash: txHash || w.tx_hash,
    reviewed_by: currentUser.id,
    reviewed_at: new Date().toISOString()
  }).eq('id', id).eq('status', w.status);
  if (updateError) return updateError.message;
  if (newStatus === 'rejected' && w.status === 'pending') {
    const { data: wallet } = await supabaseClient.from('wallets').select('sfc_balance').eq('user_id', w.user_id).maybeSingle();
    if (wallet) {
      const { error: refundError } = await supabaseClient.from('wallets').update({
        sfc_balance: Number(wallet.sfc_balance) + Number(w.amount_sfc),
        updated_at: new Date().toISOString()
      }).eq('user_id', w.user_id);
      if (refundError) return 'aprovado, mas estorno falhou: ' + refundError.message;
    }
    const { error: ledgerError } = await supabaseClient.from('ledger_entries').insert({
      user_id: w.user_id, type: 'withdrawal', amount_sfc: Number(w.amount_sfc),
      metadata: { reason: 'rejected', withdrawal_id: id }
    });
    if (ledgerError) console.error('ledger reject:', ledgerError);
  }
  if ((newStatus === 'approved' || newStatus === 'paid') && w.status === 'pending') {
    const { error: ledgerError } = await supabaseClient.from('ledger_entries').insert({
      user_id: w.user_id, type: 'withdrawal', amount_sfc: -Number(w.amount_sfc),
      metadata: { reason: newStatus, withdrawal_id: id, wallet: w.polygon_wallet }
    });
    if (ledgerError) console.error('ledger approve:', ledgerError);
  }
  return null;
}

const ADMIN_SQL_TABLES = ['profiles', 'wallets', 'posts', 'comments', 'post_likes', 'reposts', 'tips', 'stories', 'ledger_entries', 'withdrawals', 'daily_active_users'];
const ADMIN_SQL_IDENT = /^[a-z_][a-z0-9_]*$/i;

function parseAdminSqlValue(raw) {
  const value = raw.trim();
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new Error(`valor não suportado: ${value} (use 'texto', número, true ou false)`);
}

function parseAdminSql(input) {
  const sql = input.replace(/\s+/g, ' ').trim().replace(/;$/, '');
  const match = sql.match(/^select\s+(.+?)\s+from\s+([a-z_][a-z0-9_]*)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+([a-z_][a-z0-9_]*)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i);
  if (!match) throw new Error('sintaxe não suportada. Use: select colunas from tabela [where ...] [order by col] [limit n]');
  const [, columnsRaw, table, whereRaw, orderCol, orderDir, limitRaw] = match;
  if (!ADMIN_SQL_TABLES.includes(table)) throw new Error(`tabela não permitida: ${table}`);
  const columns = columnsRaw.trim() === '*' ? ['*'] : columnsRaw.split(',').map((c) => c.trim());
  columns.forEach((c) => { if (c !== '*' && !ADMIN_SQL_IDENT.test(c)) throw new Error(`coluna inválida: ${c}`); });
  const filters = [];
  if (whereRaw) {
    for (const part of whereRaw.split(/\s+and\s+/i)) {
      const isNull = part.match(/^([a-z_][a-z0-9_]*)\s+is\s+(not\s+)?null$/i);
      if (isNull) {
        if (!ADMIN_SQL_IDENT.test(isNull[1])) throw new Error(`coluna inválida: ${isNull[1]}`);
        filters.push({ col: isNull[1], op: isNull[2] ? 'notnull' : 'null' });
        continue;
      }
      const cond = part.match(/^([a-z_][a-z0-9_]*)\s*(!=|<>|>=|<=|=|>|<|like|ilike)\s*(.+)$/i);
      if (!cond) throw new Error(`condição não suportada: ${part}`);
      if (!ADMIN_SQL_IDENT.test(cond[1])) throw new Error(`coluna inválida: ${cond[1]}`);
      filters.push({ col: cond[1], op: cond[2].toLowerCase(), value: parseAdminSqlValue(cond[3]) });
    }
  }
  const limit = Math.min(500, Math.max(1, Number(limitRaw) || 100));
  return { table, columns, filters, order: orderCol ? { col: orderCol, asc: (orderDir || 'asc').toLowerCase() === 'asc' } : null, limit };
}

function applyAdminSqlFilters(query, filters) {
  let q = query;
  for (const f of filters) {
    if (f.op === '=') q = q.eq(f.col, f.value);
    else if (f.op === '!=' || f.op === '<>') q = q.neq(f.col, f.value);
    else if (f.op === '>') q = q.gt(f.col, f.value);
    else if (f.op === '>=') q = q.gte(f.col, f.value);
    else if (f.op === '<') q = q.lt(f.col, f.value);
    else if (f.op === '<=') q = q.lte(f.col, f.value);
    else if (f.op === 'like') q = q.like(f.col, f.value);
    else if (f.op === 'ilike') q = q.ilike(f.col, f.value);
    else if (f.op === 'null') q = q.is(f.col, null);
    else if (f.op === 'notnull') q = q.not(f.col, 'is', null);
  }
  return q;
}

function renderAdminSqlResult(rows, ms, table) {
  const meta = document.getElementById('adminSqlMeta');
  const box = document.getElementById('adminSqlResult');
  meta.textContent = `${rows.length} linha(s) · ${ms} ms · from ${table}`;
  if (!rows.length) { box.innerHTML = '<div class="admin-empty">Nenhuma linha retornada.</div>'; return; }
  const headers = Object.keys(rows[0]);
  const cell = (v) => v === null || v === undefined ? '<span class="sql-null">null</span>' : typeof v === 'object' ? escapeHtml(JSON.stringify(v)) : escapeHtml(String(v));
  box.innerHTML = `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${cell(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function runAdminSql() {
  const errorBox = document.getElementById('adminSqlError');
  const box = document.getElementById('adminSqlResult');
  errorBox.textContent = '';
  if (!currentUser || (currentUser.email || '').toLowerCase() !== ADMIN_EMAIL) { errorBox.textContent = 'Acesso restrito ao administrador.'; return; }
  if (!supabaseClient) { errorBox.textContent = 'Supabase não configurado.'; return; }
  let parsed;
  try {
    parsed = parseAdminSql(document.getElementById('adminSqlInput').value);
  } catch (err) {
    errorBox.textContent = err.message;
    box.innerHTML = '<div class="admin-empty">Consulta não executada.</div>';
    document.getElementById('adminSqlMeta').textContent = '';
    return;
  }
  const started = performance.now();
  let query = supabaseClient.from(parsed.table).select(parsed.columns.join(','));
  query = applyAdminSqlFilters(query, parsed.filters);
  if (parsed.order) query = query.order(parsed.order.col, { ascending: parsed.order.asc });
  query = query.limit(parsed.limit);
  const { data, error } = await query;
  const ms = Math.round(performance.now() - started);
  if (error) {
    errorBox.textContent = error.message;
    box.innerHTML = '<div class="admin-empty">Consulta falhou.</div>';
    document.getElementById('adminSqlMeta').textContent = '';
    return;
  }
  renderAdminSqlResult(data || [], ms, parsed.table);
}

document.getElementById('adminSqlRun').addEventListener('click', runAdminSql);
document.getElementById('adminSqlInput').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runAdminSql();
});
document.getElementById('adminSqlChips').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-sql]');
  if (!chip) return;
  document.getElementById('adminSqlInput').value = chip.dataset.sql;
  runAdminSql();
});

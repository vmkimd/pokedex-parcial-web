// ---------- Configuración y estado ----------
const API_BASE = "https://pokeapi.co/api/v2";
const ART_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/";
const LS_KEY = "pokedex:favorites";

/** @type {{id:number,name:string,types:string[],img:string,stats?:any,abilities?:any,height?:number,weight?:number,base_experience?:number}[]} */
let allPokemon = [];
/** @type {Set<number>} */
let favorites = new Set((JSON.parse(localStorage.getItem(LS_KEY) || "[]")).map(Number));
let currentLimit = 20;         // arranca en 20 
let currentFilter = "";
let onlyFavorites = false;
let lastFocus = null;
// Abort para búsquedas rápidas consecutivas
let activeSearchAbort = null;

// ---------- Elementos del DOM ----------
const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const loadingBlock = document.getElementById("loadingBlock");
const favCounter = document.getElementById("favCounter");
const metaInfo = document.getElementById("metaInfo");

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const onlyFavs = document.getElementById("onlyFavs");

const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
let selectedTypes = new Set();
const typeFilterEl = document.getElementById('typeFilter');

const limitSelect = document.getElementById("limitSelect");
const btnLoad20 = document.getElementById("btnLoad20");

// Modal
const dlg = document.getElementById("detailDialog");
const dlgClose = document.getElementById("dlgClose");
const dlgFavBtn = document.getElementById("dlgFavBtn");
const dlgTitle = document.getElementById("dlgTitle");
const dlgImg = document.getElementById("dlgImg");
const dlgTypes = document.getElementById("dlgTypes");
const dlgBasic = document.getElementById("dlgBasic");
const dlgStats = document.getElementById("dlgStats");
const dlgAbilities = document.getElementById("dlgAbilities");

const toastEl = document.getElementById("toast");

// ---------- Utilidades ----------
const imgFor = (id) => `${ART_BASE}${id}.png`;
const showToast = (msg) => {
  toastEl.textContent = msg;
  toastEl.classList.add("toast--show");
  setTimeout(() => toastEl.classList.remove("toast--show"), 2000);
};
const saveFavs = () => {
  localStorage.setItem(LS_KEY, JSON.stringify([...favorites]));
  favCounter.textContent = `★ Favoritos: ${favorites.size}`;
};

// Normaliza query para /pokemon/{name|id}
function normalizeQuery(q) {
  const raw = String(q ?? "").trim().toLowerCase();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
}

function buildTypeFilter(){
  if (!typeFilterEl) return;
  typeFilterEl.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Chip "Todos"
  const clear = document.createElement('button');
  clear.className = 'type-filter__chip type-filter__chip--clear';
  clear.textContent = 'Todos';
  clear.dataset.type = 'ALL';
  clear.setAttribute('aria-pressed', selectedTypes.size === 0 ? 'true' : 'false');
  frag.appendChild(clear);

  // Chips por tipo
  TYPES.forEach(t=>{
    const b = document.createElement('button');
    b.className = `type-filter__chip type-chip type-chip--${t}`;
    b.textContent = t;
    b.dataset.type = t;
    b.setAttribute('aria-pressed', selectedTypes.has(t) ? 'true' : 'false');
    frag.appendChild(b);
  });

  typeFilterEl.appendChild(frag);
}

function setLoadingUI(isLoading){
  loadingBlock.hidden = !isLoading;
  grid.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  searchInput.disabled = isLoading;
  clearBtn.disabled = isLoading;
  limitSelect.disabled = isLoading;
  onlyFavs.disabled = isLoading;
}

// ---------- Fetch a la API (Parte II) ----------
async function fetchList(limit = 151){
  setLoadingUI(true);
  try{
    // 1) Lista base
    const res = await fetch(`${API_BASE}/pokemon?limit=${limit}`);
    if(!res.ok) throw new Error("No se pudo obtener la lista");
    const data = await res.json();
    const baseList = data.results;

    // 2) Detalle por cada Pokémon (en lotes para no bloquear)
    const chunkSize = 25;
    const details = [];

    for(let i = 0; i < baseList.length; i += chunkSize){
      const chunk = baseList.slice(i, i + chunkSize);

      const chunkResults = await Promise.all(chunk.map(async (p) => {
        try{
          const dr = await fetch(p.url); // requisito: usar p.url
          if(!dr.ok) throw new Error();
          const d = await dr.json();

          const id = d.id;
          const imgUrl =
            d.sprites?.other?.["official-artwork"]?.front_default ||
            d.sprites?.other?.dream_world?.front_default ||
            d.sprites?.front_default ||
            imgFor(id);

          return {
            id,
            name: d.name,
            img: imgUrl,
            types: d.types.map(t => t.type.name),
            stats: d.stats.map(s => ({ name: s.stat.name, base: s.base_stat })),
            abilities: d.abilities.map(a => a.ability.name),
            height: d.height,
            weight: d.weight,
            base_experience: d.base_experience
          };
        }catch{
          const idFromUrl = Number(p.url.match(/\/pokemon\/(\d+)\//)?.[1] || 0);
          return {
            id: idFromUrl,
            name: p.name,
            img: imgFor(idFromUrl),
            types: [],
            stats: [],
            abilities: []
          };
        }
      }));

      details.push(...chunkResults);
    }

    // 3) Guardar
    allPokemon = details;
    metaInfo.innerHTML = `Mostrando <strong>${allPokemon.length}</strong> Pokémon • Fuente: <a href="https://pokeapi.co/" target="_blank" rel="noreferrer">PokeAPI</a>`;
  }catch(err){
    console.error(err);
    showToast("Error al consultar la PokeAPI");
  }finally{
    setLoadingUI(false);
  }
}

async function fetchDetail(idOrName){
  const res = await fetch(`${API_BASE}/pokemon/${idOrName}`);
  if(!res.ok) throw new Error("No se pudo obtener el detalle");
  return res.json();
}

// ---------- Render (Parte III) ----------
function renderList(){
  const term = currentFilter.trim().toLowerCase();
  const favOnly = onlyFavorites;

  // filtro (texto, favoritos y tipos)
  const filtered = allPokemon.filter(p => {
    const matchesTerm = !term || p.name.includes(term) || String(p.id) === term;
    const isFav = favorites.has(p.id);
    const typeOk = selectedTypes.size === 0 || p.types.some(tp => selectedTypes.has(tp));
    return matchesTerm && (!favOnly || isFav) && typeOk;
  });

  // Vaciar y pintar
  grid.innerHTML = "";
  emptyState.hidden = filtered.length !== 0;

  const frag = document.createDocumentFragment();
  filtered.forEach(p => {
    const isFav = favorites.has(p.id);

    const card = document.createElement("article");
    card.className =
      "poke-card pokemon-card pokemon-list__item" +
      (isFav ? " pokemon-card--favorite" : "");
    card.setAttribute("role","listitem");
    card.dataset.id = String(p.id);

    const favPressed = isFav ? "true" : "false";
    const favSymbol = isFav ? "★" : "☆";

    card.innerHTML = `
      <button class="poke-card__fav-btn" data-action="fav" aria-pressed="${favPressed}" title="Favorito">${favSymbol}</button>
      <div class="poke-card__media">
        <img class="poke-card__img" loading="lazy" src="${p.img}" alt="Imagen de ${p.name}" />
      </div>
      <div class="poke-card__id">#${String(p.id).padStart(3,"0")}</div>
      <h3 class="poke-card__title">${p.name}</h3>
      <div class="poke-card__types">
        ${p.types.map(t => `<span class="type-chip type-chip--${t}">${t}</span>`).join("")}
      </div>
    `;
    card.setAttribute('tabindex','0');
    card.setAttribute('aria-label', `Ver detalle de ${p.name}`);
    frag.appendChild(card);
  });

  grid.appendChild(frag);
  saveFavs();
  renderFavorites();
}

function renderDetail(d){
  const id = d.id;

  // Título e imagen
  dlgTitle.textContent = `${d.name}  #${String(id).padStart(3,"0")}`;
  dlgImg.src =
    d.sprites?.other?.["official-artwork"]?.front_default ||
    d.sprites?.other?.dream_world?.front_default ||
    d.sprites?.front_default ||
    imgFor(id);
  dlgImg.alt = `Imagen de ${d.name}`;

  // Tipos
  dlgTypes.innerHTML = d.types.map(t => `<span class="type-chip type-chip--${t.type.name}">${t.type.name}</span>`).join("");

  // Datos básicos
  dlgBasic.innerHTML = `
    <span class="stat">Altura: <strong>${(d.height/10).toFixed(1)} m</strong></span>
    <span class="stat">Peso: <strong>${(d.weight/10).toFixed(1)} kg</strong></span>
    <span class="stat">Base XP: <strong>${d.base_experience ?? 0}</strong></span>
  `;

  // Stats
  dlgStats.innerHTML = d.stats.map(s => {
    const base = s.base_stat;
    const pct = Math.min(100, Math.round((base/180)*100));
    const label = s.stat.name.replace("-", " ");
    return `
      <div class="stat" style="min-width:220px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span style="text-transform:capitalize">${label}</span>
          <strong>${base}</strong>
        </div>
        <div class="stat__bar"><div class="stat__bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join("");

  // Habilidades
  dlgAbilities.innerHTML = d.abilities.map(a => `<span class="stat" style="text-transform:capitalize">${a.ability.name}</span>`).join("");

  // Estado del botón de favorito dentro del modal
  dlgFavBtn.setAttribute("aria-pressed", favorites.has(id) ? "true" : "false");
  dlgFavBtn.textContent = favorites.has(id) ? "★" : "☆";
  dlgFavBtn.dataset.id = String(id);

  // Abrir modal
  if(typeof dlg.showModal === "function"){ dlg.showModal(); }
  else { dlg.setAttribute("open",""); }
  dlgClose.focus();
}

function renderFavorites(){
  const favList = document.getElementById("favList");
  const favEmpty = document.getElementById("favEmpty");
  if(!favList || !favEmpty) return;

  const favIds = [...favorites];
  favList.innerHTML = "";

  if(favIds.length === 0){
    favEmpty.hidden = false;
    return;
  }
  favEmpty.hidden = true;

  const frag = document.createDocumentFragment();
  favIds.forEach(id=>{
    const p = allPokemon.find(x => x.id === id);
    const name = p ? p.name : `#${id}`;
    const li = document.createElement("li");
    li.className = "favorites__item";
    li.innerHTML = `
      <button class="favorites__chip" data-id="${id}" title="Ver detalle de ${name}">
        ★ ${name}
      </button>
    `;
    frag.appendChild(li);
  });
  favList.appendChild(frag);
}

// ---------- Eventos ----------
// teclado en tarjetas
grid.addEventListener('keydown', async (ev)=>{
  const card = ev.target.closest('.poke-card');
  if(!card) return;
  if(ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  const id = Number(card.dataset.id);
  try{
    setLoadingUI(true);
    const detail = await fetchDetail(id);
    lastFocus = card;
    renderDetail(detail);
  }catch(_){
    showToast("No se pudo cargar el detalle");
  }finally{
    setLoadingUI(false);
  }
});

// Clic en tarjetas
grid.addEventListener("click", async (ev)=>{
  const card = ev.target.closest(".poke-card");
  if(!card) return;
  const id = Number(card.dataset.id);

  if(ev.target.matches(".poke-card__fav-btn")){
    toggleFav(id, ev.target);
    ev.stopPropagation();
    return;
  }

  try{
    setLoadingUI(true);
    const detail = await fetchDetail(id);
    lastFocus = card;
    renderDetail(detail);
  }catch(err){
    console.error(err);
    showToast("No se pudo cargar el detalle");
  }finally{
    setLoadingUI(false);
  }
});

// Clic en chip del aside de favoritos (abre detalle)
document.getElementById("favList")?.addEventListener("click", async (e)=>{
  const btn = e.target.closest(".favorites__chip");
  if(!btn) return;
  try{
    setLoadingUI(true);
    const id = Number(btn.dataset.id);
    const detail = await fetchDetail(id);
    lastFocus = btn;
    renderDetail(detail);
  }catch(_){
    showToast("No se pudo cargar el detalle");
  }finally{
    setLoadingUI(false);
  }
});

// Cerrar modal y favorito desde modal
dlgFavBtn.addEventListener("click", ()=>{
  const id = Number(dlgFavBtn.dataset.id);
  toggleFav(id, dlgFavBtn);
});
dlgClose.addEventListener("click", ()=> dlg.close());
dlg.addEventListener("click", (e)=>{ if(e.target === dlg) dlg.close(); });
dlg.addEventListener('close', ()=>{ if(lastFocus) lastFocus.focus(); });

// Switch de solo favoritos
onlyFavs.addEventListener("change", (e)=>{
  onlyFavorites = e.target.checked;
  renderList();
});

// Filtro por tipo
typeFilterEl?.addEventListener('click', (e)=>{
  const btn = e.target.closest('.type-filter__chip');
  if(!btn) return;
  const t = btn.dataset.type;

  if(t === 'ALL'){
    selectedTypes.clear();
  }else{
    if(selectedTypes.has(t)) selectedTypes.delete(t);
    else selectedTypes.add(t);
  }
  buildTypeFilter();
  renderList();
});

// ---------- BÚSQUEDA GLOBAL ----------
searchForm.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const raw = searchInput.value;
  const q = normalizeQuery(raw);

  if (!q) {
    currentFilter = "";
    renderList();
    return;
  }

  if (activeSearchAbort) activeSearchAbort.abort();
  activeSearchAbort = new AbortController();

  try {
    setLoadingUI(true);
    const detail = await fetch(`${API_BASE}/pokemon/${encodeURIComponent(q)}`, { signal: activeSearchAbort.signal });
    if (detail.status === 404) {
      showToast("No se encontró ningún Pokémon con ese nombre o ID.");
      return;
    }
    if (!detail.ok) throw new Error("Error en la búsqueda");
    const data = await detail.json();

    lastFocus = searchInput;
    renderDetail(data);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      showToast("Ocurrió un error al consultar la PokeAPI.");
    }
  } finally {
    setLoadingUI(false);
    activeSearchAbort = null;
  }
});

// Limpiar
clearBtn.addEventListener('click', ()=>{
  searchInput.value = "";
  currentFilter = "";
  selectedTypes.clear();
  onlyFavs.checked = false;
  onlyFavorites = false;
  buildTypeFilter();
  renderList();
});

// Cambio de límite
limitSelect.addEventListener('change', async ()=>{
  currentLimit = Number(limitSelect.value);
  await fetchList(currentLimit);
  renderList();
});

// Botón requerido: Cargar 20 iniciales
btnLoad20.addEventListener('click', async ()=>{
  limitSelect.value = "20";
  currentLimit = 20;
  await fetchList(20);
  renderList();
});

// ---------- Favoritos (Parte IV) ----------
function toggleFav(id, buttonEl){
  if(favorites.has(id)) favorites.delete(id);
  else favorites.add(id);

  saveFavs();

  if(buttonEl){
    buttonEl.setAttribute("aria-pressed", favorites.has(id) ? "true" : "false");
    buttonEl.textContent = favorites.has(id) ? "★" : "☆";
    const card = buttonEl.closest(".pokemon-card, .poke-card");
    if(card){
      card.classList.toggle("pokemon-card--favorite", favorites.has(id));
    }
  }

  // Sincroniza la tarjeta en la grilla
  const gridCard = grid.querySelector(`.poke-card[data-id="${id}"]`);
  if (gridCard) {
    const starBtn = gridCard.querySelector('.poke-card__fav-btn');
    if (starBtn) {
      starBtn.setAttribute('aria-pressed', favorites.has(id) ? 'true' : 'false');
      starBtn.textContent = favorites.has(id) ? '★' : '☆';
    }
    gridCard.classList.toggle('pokemon-card--favorite', favorites.has(id));
  }

  if(onlyFavorites) renderList();
  renderFavorites();
}

// ---------- Inicio ----------
(async function init(){
  limitSelect.value = String(currentLimit);
  saveFavs();
  buildTypeFilter();
  renderList();
})();
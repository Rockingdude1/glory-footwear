// Serverless proxy in front of the Google Sheets CSV feed.
//
// The client used to fetch the sheet directly, which meant every visitor's
// browser received the raw CSV — stock numbers included — before any
// password check could ever happen. Moving the fetch here means the numbers
// never leave the server unless the request carries a valid admin session
// cookie; everyone else gets status only (In Stock/Low/Out), never the count.
//
// This file intentionally duplicates parseCSV/buildProducts from index.html
// rather than importing them, since the client copy runs in a browser (no
// require()) and this one runs in Node — keeping them independent avoids
// needing a bundler for what is otherwise a zero-build static site. If you
// change the parsing rules in index.html, mirror the change here too.

const crypto = require('crypto');

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR54-gum7tJx1OfoK5zT2bYu0pqj3Ubw6bu0QFK6xBJZMfUq_snykGGOc7dVUu0FlnaXxz1eI-TlTe9/pub?gid=0&single=true&output=csv";
const LOW_STOCK_THRESHOLD = 5;
const SESSION_MESSAGE = 'glory-admin-session';

function computeSessionToken(secret){
  return crypto.createHmac('sha256', secret).update(SESSION_MESSAGE).digest('hex');
}

function isAuthenticated(req){
  const secret = process.env.ADMIN_PASSWORD;
  if(!secret) return false;
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)glory_admin=([a-f0-9]+)/);
  if(!match) return false;
  const expected = computeSessionToken(secret);
  const given = match[1];
  if(given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch(e) {
    return false;
  }
}

// Normalizes whatever wording ends up in the Gender column ("Male"/"Female"
// or "Men"/"Women", any casing) to a single consistent label. Kept in sync
// with the identical helper in index.html.
function normalizeGender(raw){
  const key = raw.trim().toLowerCase().replace(/s$/, ''); // "Mens"/"Womens" -> "men"/"women"
  if(key === 'male' || key === 'man' || key === 'men') return 'Men';
  if(key === 'female' || key === 'woman' || key === 'women') return 'Women';
  return raw.trim();
}

function splitCSVLine(line){
  const out=[]; let cur=''; let inQuotes=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inQuotes){
      if(c==='"'){
        if(line[i+1]==='"'){ cur+='"'; i++; } else { inQuotes=false; }
      } else cur+=c;
    } else {
      if(c==='"') inQuotes=true;
      else if(c===','){ out.push(cur); cur=''; }
      else cur+=c;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim().length>0);
  if(lines.length < 2) throw new Error('Data needs a header row plus at least one product row.');

  let headerRowIdx = 0;
  for(let i=0;i<Math.min(lines.length, 5);i++){
    const probe = splitCSVLine(lines[i]).map(h=>h.trim().toLowerCase().replace(/\s+/g, ''));
    if(probe.includes('stock')){ headerRowIdx = i; break; }
  }

  const headers = splitCSVLine(lines[headerRowIdx]).map(h=>h.trim().toLowerCase().replace(/\s+/g, ''));
  const idx = {};
  headers.forEach((h,i)=>{ if(idx[h]===undefined) idx[h]=i; });

  const skuIdx = [idx.sku, idx.itemdetails, idx.code, idx.name].find(v=>v!==undefined);
  const colorIdx = idx.color !== undefined ? idx.color : idx['p1(color)'];
  const sizeIdx = idx.size !== undefined ? idx.size : idx['p2(size)'];
  const categoryIdx = idx.category;
  const priceIdx = idx.mrp !== undefined ? idx.mrp : idx.price;
  const stockIdx = idx.stock;
  const genderIdx = idx.gender;
  const bestsellerIdx = idx.bestseller;
  const newArrivalIdx = idx.newarrival;
  const imageIdxs = headers.map((h,i)=>h.indexOf('imageurl')===0 ? i : -1).filter(i=>i>=0);

  if(skuIdx===undefined || stockIdx===undefined){
    throw new Error('Could not find a product-identifier column ("Item Details"/"SKU"/"NAME") and a "STOCK" column.');
  }

  const items = [];
  let lastSku = null;
  let currentCategory = '';
  let lastGenderForSku = '';
  let lastNewArrivalForSku = false;
  let lastBestsellerForSku = false;

  for(let i=0;i<headerRowIdx;i++){
    const first = splitCSVLine(lines[i])[0];
    if(first && first.trim()) currentCategory = first.trim();
  }

  for(let i=headerRowIdx+1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]);
    if(cols.every(c=>c.trim()==='')) continue;

    const skuCell = (cols[skuIdx]||'').trim();
    const color = colorIdx!==undefined ? (cols[colorIdx]||'').trim() : '';
    const size = sizeIdx!==undefined ? (cols[sizeIdx]||'').trim() : '';

    if(skuCell){
      lastSku = skuCell;
      lastGenderForSku = '';
      lastNewArrivalForSku = false;
      lastBestsellerForSku = false;
    }

    if(!color && !size){
      if(skuCell) currentCategory = skuCell;
      continue;
    }

    const sku = lastSku || skuCell;
    if(!sku) continue;

    const cellCategory = categoryIdx!==undefined ? (cols[categoryIdx]||'').trim() : '';
    const rowCategory = cellCategory || currentCategory;
    const rowStock = parseInt(cols[stockIdx], 10) || 0;
    const rowPrice = priceIdx!==undefined && cols[priceIdx] ? (parseFloat(cols[priceIdx]) || null) : null;

    const rowGenderRaw = genderIdx!==undefined ? (cols[genderIdx]||'').trim() : '';
    if(rowGenderRaw) lastGenderForSku = normalizeGender(rowGenderRaw);
    const gender = lastGenderForSku;

    const rowBestsellerRaw = bestsellerIdx!==undefined ? (cols[bestsellerIdx]||'').trim() : '';
    if(rowBestsellerRaw) lastBestsellerForSku = /^y/i.test(rowBestsellerRaw);
    const isBestseller = lastBestsellerForSku;

    const rowNewArrivalRaw = newArrivalIdx!==undefined ? (cols[newArrivalIdx]||'').trim() : '';
    if(rowNewArrivalRaw) lastNewArrivalForSku = /^y/i.test(rowNewArrivalRaw);
    const isNewArrival = lastNewArrivalForSku;

    if(color.toLowerCase().includes('mix')){
      const urls = imageIdxs.map(ci => (cols[ci]||'').trim()).filter(Boolean);
      items.push({
        sku, category: rowCategory, color: 'MIX', size,
        stock: rowStock, price: rowPrice,
        imageUrl: urls[0] || '', imageUrls: urls,
        gender, isNewArrival, isBestseller
      });
      continue;
    }

    let imageUrl = '';
    for(const ci of imageIdxs){
      const v = (cols[ci]||'').trim();
      if(v){ imageUrl = v; break; }
    }

    items.push({
      sku: sku,
      category: rowCategory,
      color: color,
      size: size,
      gender: gender,
      isNewArrival: isNewArrival,
      isBestseller: isBestseller,
      stock: rowStock,
      price: rowPrice,
      imageUrl: imageUrl
    });
  }
  return items;
}

function stockStatus(stock){
  if(stock <= 0) return 'out';
  if(stock <= LOW_STOCK_THRESHOLD) return 'low';
  return 'in';
}

function buildProducts(items){
  const bySku = new Map();

  items.forEach(it => {
    if(!bySku.has(it.sku)){
      bySku.set(it.sku, {
        sku: it.sku, category: it.category, price: null, colors: new Map(), totalStock: 0,
        gender: it.gender || '', isNewArrival: false, isBestseller: false
      });
    }
    const product = bySku.get(it.sku);
    if(!product.category && it.category) product.category = it.category;
    if(it.isNewArrival) product.isNewArrival = true;
    if(it.isBestseller) product.isBestseller = true;
    if(it.price!=null && (product.price==null || it.price < product.price)) product.price = it.price;

    const colorKey = it.color || 'Standard';
    if(!product.colors.has(colorKey)){
      product.colors.set(colorKey, { color: colorKey, imageUrl: '', photoSet: new Set(), stock: 0, sizes: [] });
    }
    const colorEntry = product.colors.get(colorKey);
    if(!colorEntry.imageUrl && it.imageUrl) colorEntry.imageUrl = it.imageUrl;
    (it.imageUrls && it.imageUrls.length ? it.imageUrls : (it.imageUrl ? [it.imageUrl] : []))
      .forEach(u => colorEntry.photoSet.add(u));
    colorEntry.sizes.push({ size: it.size, stock: it.stock, price: it.price });
    colorEntry.stock += it.stock;
    product.totalStock += it.stock;
  });

  return Array.from(bySku.values()).map(p => {
    const colors = Array.from(p.colors.values()).map(c => {
      const { photoSet, ...rest } = c;
      return { ...rest, photos: Array.from(photoSet) };
    });
    return { ...p, colors };
  });
}

// Strips exact stock counts for unauthenticated requests, keeping only the
// derived status (In Stock/Low/Out) so the UI can still render its badges —
// this is the actual protection; the admin password just decides which
// branch a given request takes.
function shapeForResponse(products, authed){
  return products.map(p => ({
    sku: p.sku,
    category: p.category,
    price: p.price,
    gender: p.gender,
    isNewArrival: p.isNewArrival,
    isBestseller: p.isBestseller,
    totalStock: authed ? p.totalStock : undefined,
    totalStatus: stockStatus(p.totalStock),
    colors: p.colors.map(c => ({
      color: c.color,
      imageUrl: c.imageUrl,
      photos: c.photos,
      stock: authed ? c.stock : undefined,
      status: stockStatus(c.stock),
      sizes: c.sizes.map(s => ({
        size: s.size,
        price: s.price,
        stock: authed ? s.stock : undefined,
        status: stockStatus(s.stock)
      }))
    }))
  }));
}

module.exports = async (req, res) => {
  try {
    const sheetRes = await fetch(GOOGLE_SHEET_CSV_URL, { cache: 'no-store' });
    if(!sheetRes.ok) throw new Error('HTTP error: ' + sheetRes.status);
    const text = await sheetRes.text();

    if(text.trim().toLowerCase().startsWith('<!doctype html>') || text.trim().toLowerCase().startsWith('<html')){
      throw new Error('Google is blocking access (requires login)');
    }

    const items = parseCSV(text);
    const products = buildProducts(items);
    const authed = isAuthenticated(req);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      products: shapeForResponse(products, authed),
      isAdmin: authed,
      syncedAt: new Date().toISOString()
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

// ============================================================
//  CALL BREAK PRO — v3.0  Landscape · Professional
//  Features: scoreboard, per-round leaderboard, bid/won HUD,
//  card throw animation, swipe-to-play, auto-sort, bot naming,
//  trick-win fly-to-winner animation, full scoring panel
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, Users, Trophy, ChevronLeft, Zap, RotateCcw, Star, Info, SortAsc } from "lucide-react";

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const SUITS      = ['S','H','D','C'];
const SUIT_NAMES = { S:'Spades', H:'Hearts', D:'Diamonds', C:'Clubs' };
const SUIT_SYM   = { S:'♠', H:'♥', D:'♦', C:'♣' };
const SUIT_RED   = { S:false, H:true, D:true, C:false };
const RANKS      = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RV         = Object.fromEntries(RANKS.map((r,i)=>[r,i]));

const PHASE = { AUCTION:'AUCTION', REVEAL:'REVEAL', BIDDING:'BIDDING', PLAYING:'PLAYING', ROUND_END:'ROUND_END' };

// Bot names matching the reference screenshots
const PLAYER_NAMES   = ['You','Bot1','Bot2','Bot3'];
const PLAYER_AVATARS = ['🧑','🤖','🤖','🤖'];
// Seat positions for landscape layout (0=bottom/you, 1=left, 2=top, 3=right)
const SEAT_POS = ['bottom','left','top','right'];
const CCW = [0,3,2,1];
function ccwNext(s){ return CCW[(CCW.indexOf(s)+1)%4]; }

// ═══════════════════════════════════════════════════════════
//  GAME ENGINE
// ═══════════════════════════════════════════════════════════
const mkCard = (suit,rank) => ({id:`${rank}${suit}`,suit,rank,value:RV[rank],isTrump:false});
const mkDeck = () => SUITS.flatMap(s=>RANKS.map(r=>mkCard(s,r)));
function shuffle(d){ const a=[...d]; for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]];} return a; }

function dealN(deck,hands,n){
  const h=(hands&&hands.length===4)?hands.map(x=>[...x]):[[],[],[],[]];
  const order=[0,3,2,1]; let idx=0,c=0;
  while(c<n*4){h[order[c%4]].push({...deck[idx],isTrump:false});idx++;c++;}
  return {hands:h,remaining:deck.slice(idx)};
}
function stampTrump(hands,trump){ return hands.map(h=>h.map(c=>({...c,isTrump:c.suit===trump}))); }

function beats(ch,cur,lead,trump){
  const ct=ch.suit===trump,bt=cur.suit===trump,cl=ch.suit===lead,bl=cur.suit===lead;
  if(bt&&!ct)return false; if(!bt&&ct)return true; if(bt&&ct)return ch.value>cur.value;
  if(bl&&!cl)return false; if(!bl&&cl)return true; return ch.value>cur.value;
}
function trickWinner(plays,lead,trump){ let b=plays[0]; for(let i=1;i<plays.length;i++) if(beats(plays[i].card,b.card,lead,trump))b=plays[i]; return b.seat; }

function getLegal(hand,plays,leadSuit,trump){
  if(!plays||!plays.length)return hand;
  const lc=hand.filter(c=>c.suit===leadSuit), tc=hand.filter(c=>c.suit===trump);
  if(lc.length){ const hi=Math.max(...plays.filter(p=>p.card.suit===leadSuit).map(p=>p.card.value),-1); const hc=lc.filter(c=>c.value>hi); return hc.length?hc:lc; }
  return tc.length?tc:hand;
}

// Auto-sort: by suit priority then rank desc
function autoSort(hand,trump){
  const suitOrder = [trump,...SUITS.filter(s=>s!==trump)];
  return [...hand].sort((a,b)=>{ const sd=suitOrder.indexOf(a.suit)-suitOrder.indexOf(b.suit); return sd||b.value-a.value; });
}

function evalHand(hand,suit){ let s=0; for(const c of hand){ const v=c.value; if(c.suit===suit)s+=v>=10?5:v>=8?3:2; else if(v===12)s+=4; else if(v===11)s+=2; else if(v===10)s+=1; } return s; }
function aiBidAuction(hand,curHigh,isFirst){ const min=isFirst?5:curHigh+1; let best=0,suit=null; SUITS.forEach(s=>{const sc=evalHand(hand,s);if(sc>best){best=sc;suit=s;}}); const exp=Math.round(best/3); return exp<min?{action:'pass'}:{action:'bid',bid:Math.max(min,Math.min(exp,8)),suit}; }
function aiStdBid(hand,trump){ let w=0; const tr=hand.filter(c=>c.suit===trump).sort((a,b)=>b.value-a.value); tr.forEach((c,i)=>{if(c.value>=10)w+=1;else if(c.value>=6&&i===0)w+=0.5;}); w+=hand.filter(c=>c.suit!==trump&&c.rank==='A').length*0.8+1.5; return Math.max(1,Math.round(w)); }
function aiCard(hand,plays,leadSuit,trump){ const legal=getLegal(hand,plays||[],leadSuit,trump); if(!plays||!plays.length){ const tr=legal.filter(c=>c.suit===trump).sort((a,b)=>b.value-a.value); if(tr.length>=2)return tr[0]; const hi=legal.filter(c=>c.value>=11).sort((a,b)=>b.value-a.value); return hi.length?hi[0]:[...legal].sort((a,b)=>b.value-a.value)[0]; } const hv=Math.max(...plays.map(p=>p.card.value)); const win=legal.filter(c=>c.value>hv); return win.length?win.sort((a,b)=>a.value-b.value)[0]:[...legal].sort((a,b)=>a.value-b.value)[0]; }
function calcScore(bid,won){ return won>=bid?parseFloat((bid+(won-bid)*0.1).toFixed(1)):-bid; }

function initRound(dealer=0,scores=[0,0,0,0],roundNum=1){
  const deck=shuffle(mkDeck()); const {hands,remaining}=dealN(deck,null,5);
  const di=CCW.indexOf(dealer); const first=CCW[(di+1)%4];
  return { phase:PHASE.AUCTION, dealer, hands, remaining, roundNum,
    auction:{currentBidder:first,highestBid:4,highestBidder:null,chosenSuit:null,bids:[],passedSeats:new Set(),done:false},
    trump:null, bids:[null,null,null,null], trickPlays:[], leadSuit:null,
    leadSeat:first, currentSeat:first, tricksWon:[0,0,0,0],
    scores:[...scores], roundScores:[0,0,0,0], auctionWinner:null, totalTricks:0, log:[],
    history:[], // [{roundNum, bids, tricksWon, roundScores, trump}]
    flyAnim:null, // {cardId, fromSeat, toSeat}
  };
}

// ═══════════════════════════════════════════════════════════
//  CSS KEYFRAMES (injected once)
// ═══════════════════════════════════════════════════════════
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Teko:wght@400;600;700&family=Nunito:wght@400;600;700;800;900&display=swap');
  * { box-sizing: border-box; }
  body { margin:0; overflow:hidden; }
  .cb-root { font-family:'Nunito',sans-serif; width:100vw; height:100vh; overflow:hidden; }
  .cb-title { font-family:'Teko',sans-serif; letter-spacing:.05em; }

  @keyframes dealIn { from{opacity:0;transform:scale(0.4) translateY(-40px)} to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes flyCard { 0%{transform:translate(0,0) scale(1)} 100%{transform:var(--fly-end) scale(0.5) opacity:0} }
  @keyframes trickFly { 0%{opacity:1;transform:translate(0,0) scale(1)} 60%{opacity:1;transform:var(--fly-mid) scale(0.9)} 100%{opacity:0;transform:var(--fly-end) scale(0.3)} }
  @keyframes cardThrow { 0%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-30px) rotate(var(--rot))} 100%{transform:translateY(0) rotate(0)} }
  @keyframes pulse-ring { 0%{box-shadow:0 0 0 0 rgba(250,204,21,0.5)} 70%{box-shadow:0 0 0 12px rgba(250,204,21,0)} 100%{box-shadow:0 0 0 0 rgba(250,204,21,0)} }
  @keyframes fadeSlideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes bounceIn { 0%{transform:scale(0.3);opacity:0} 60%{transform:scale(1.1)} 80%{transform:scale(0.95)} 100%{transform:scale(1);opacity:1} }
  @keyframes swipeHint { 0%,100%{transform:translateX(0)} 50%{transform:translateX(12px)} }
  @keyframes winnerGlow { 0%,100%{text-shadow:0 0 8px rgba(250,204,21,0.3)} 50%{text-shadow:0 0 24px rgba(250,204,21,0.9)} }

  .deal-in { animation: dealIn 0.35s ease-out both; }
  .bounce-in { animation: bounceIn 0.5s ease-out both; }
  .fade-slide { animation: fadeSlideUp 0.3s ease-out both; }
  .pulse-active { animation: pulse-ring 1.5s infinite; }
  .winner-glow { animation: winnerGlow 1s ease-in-out infinite; }
  .swipe-hint { animation: swipeHint 1.2s ease-in-out 3; }

  .wood-bg { background: linear-gradient(160deg,#8B4513 0%,#A0522D 30%,#8B4513 60%,#6B3410 100%);
    background-image: repeating-linear-gradient(90deg,rgba(0,0,0,0.03) 0,rgba(0,0,0,0.03) 1px,transparent 1px,transparent 40px),
    repeating-linear-gradient(0deg,rgba(255,255,255,0.02) 0,rgba(255,255,255,0.02) 1px,transparent 1px,transparent 60px); }
  .felt-bg { background: radial-gradient(ellipse at center,#1a6b3a 0%,#0f4a28 50%,#083018 100%); }
  .card-shadow { box-shadow: 2px 3px 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3); }
  .panel-bg { background:rgba(20,10,5,0.88); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.08); }

  .trick-card { transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1); }
  .trick-flying { animation: trickFly 0.7s ease-in forwards; }

  /* Landscape force */
  @media (orientation: portrait) {
    .cb-root { transform: rotate(90deg); transform-origin: center center; width:100vh; height:100vw; position:fixed; top:50%;left:50%; margin-top:-50vw; margin-left:-50vh; }
  }
`;

// ═══════════════════════════════════════════════════════════
//  CARD COMPONENTS
// ═══════════════════════════════════════════════════════════
function PlayingCard({ card, size='md', selected=false, legal=true, onClick, animDelay=0, flying=false, flyStyle={} }){
  const W = { sm:'44px', md:'54px', lg:'64px', xs:'32px' };
  const H = { sm:'64px', md:'78px', lg:'92px', xs:'46px' };
  const FS = { sm:'11px', md:'13px', lg:'15px', xs:'9px' };
  const SS = { sm:'18px', md:'22px', lg:'26px', xs:'14px' };
  const red = SUIT_RED[card.suit];

  return (
    <div onClick={legal?onClick:undefined}
      className={`deal-in rounded-xl overflow-hidden relative select-none flex flex-col justify-between card-shadow
        ${selected?'ring-2 ring-amber-400':''} ${!legal?'opacity-40':''} ${flying?'trick-flying':''}
        ${legal&&onClick?'cursor-pointer':'cursor-default'}`}
      style={{
        width:W[size], height:H[size], animationDelay:`${animDelay}ms`,
        background: card.isTrump
          ? 'linear-gradient(145deg,#fefce8,#fef9c3,#fefce8)'
          : red ? 'linear-gradient(145deg,#fff,#fef2f2)' : 'linear-gradient(145deg,#fff,#f8fafc)',
        transform: selected ? 'translateY(-16px)' : 'translateY(0)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        ...(selected ? {boxShadow:'0 12px 24px rgba(0,0,0,0.5), 0 0 0 2px #fbbf24'} : {}),
        ...flyStyle,
      }}>
      {/* Trump shimmer overlay */}
      {card.isTrump && <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{background:'linear-gradient(90deg,transparent,rgba(251,191,36,0.5),transparent)',backgroundSize:'200% 100%',animation:'shimmer 2s linear infinite'}} />}
      <div className="p-0.5">
        <div style={{fontSize:FS[size],fontWeight:900,lineHeight:1,color:red?'#dc2626':card.isTrump?'#92400e':'#1e293b'}}>{card.rank}</div>
        <div style={{fontSize:SS[size],lineHeight:1,color:red?'#dc2626':card.isTrump?'#b45309':'#1e293b'}}>{SUIT_SYM[card.suit]}</div>
      </div>
      <div className="p-0.5 self-end rotate-180">
        <div style={{fontSize:FS[size],fontWeight:900,lineHeight:1,color:red?'#dc2626':card.isTrump?'#92400e':'#1e293b'}}>{card.rank}</div>
        <div style={{fontSize:SS[size],lineHeight:1,color:red?'#dc2626':card.isTrump?'#b45309':'#1e293b'}}>{SUIT_SYM[card.suit]}</div>
      </div>
    </div>
  );
}

function CardBack({ size='md', rotation=0 }){
  const W = {sm:'44px',md:'54px',lg:'64px',xs:'32px'};
  const H = {sm:'64px',md:'78px',lg:'92px',xs:'46px'};
  return (
    <div className="rounded-xl overflow-hidden card-shadow flex-shrink-0"
      style={{width:W[size],height:H[size],transform:`rotate(${rotation}deg)`,
        background:'linear-gradient(145deg,#7c2d12,#991b1b,#7c2d12)',
        backgroundImage:'repeating-linear-gradient(45deg,rgba(255,255,255,0.05) 0,rgba(255,255,255,0.05) 2px,transparent 2px,transparent 8px)'}}>
      <div className="w-full h-full flex items-center justify-center" style={{border:'3px solid rgba(255,255,255,0.15)',margin:'4px',borderRadius:'8px',width:'calc(100% - 8px)',height:'calc(100% - 8px)'}}>
        <span style={{color:'rgba(255,255,255,0.3)',fontSize:'18px'}}>♠</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  PLAYER SEAT COMPONENT
// ═══════════════════════════════════════════════════════════
function PlayerSeat({ seat, position, hand=[], isActive, bid, tricksWon, isDealer, auctionWinner }){
  const cardCount = hand.length;
  const isLeft = position==='left', isRight = position==='right', isTop = position==='top';

  const cardEls = Array.from({length:Math.min(cardCount,13)}).map((_,i)=>(
    <div key={i} className="absolute" style={{
      left: isLeft||isRight ? `${i*5}px` : isTop ? `${i*10}px` : 0,
      top: isLeft||isRight ? `${i*3}px` : 0,
      zIndex: i,
      transform: isLeft ? `rotate(${-15+i*2}deg)` : isRight ? `rotate(${15-i*2}deg)` : isTop ? `rotate(${-8+i*1.2}deg)` : 'none',
    }}>
      <CardBack size={isLeft||isRight?'sm':'sm'} />
    </div>
  ));

  const fanW = isLeft||isRight ? Math.max(40, cardCount*5+44) : Math.max(44, cardCount*10+44);
  const fanH = isLeft||isRight ? Math.max(64, cardCount*3+64) : 64;

  const badge = (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap
      ${isActive?'bg-amber-400/25 border border-amber-400/70 text-amber-200':'bg-black/50 border border-white/10 text-slate-300'}`}
      style={isActive?{animation:'pulse-ring 1.5s infinite'}:{}}>
      {isDealer && <span className="text-xs bg-amber-500 text-black rounded-full w-4 h-4 flex items-center justify-center font-black">D</span>}
      <span>{PLAYER_AVATARS[seat]}</span>
      <span>{PLAYER_NAMES[seat]}</span>
      {bid!==null&&bid!==undefined&&<span className="text-cyan-300 font-black">·{bid}</span>}
      {tricksWon>0&&<span className="text-green-300 font-black">·{tricksWon}✓</span>}
      {auctionWinner&&<span className="text-amber-300">★</span>}
    </div>
  );

  if(position==='top') return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10">
      {badge}
      <div className="relative flex-shrink-0" style={{width:fanW+'px',height:fanH+'px'}}>{cardEls}</div>
    </div>
  );
  if(position==='left') return (
    <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10">
      {badge}
      <div className="relative" style={{width:fanW+'px',height:fanH+'px'}}>{cardEls}</div>
    </div>
  );
  if(position==='right') return (
    <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10">
      {badge}
      <div className="relative" style={{width:fanW+'px',height:fanH+'px'}}>{cardEls}</div>
    </div>
  );
  return null;
}

// ═══════════════════════════════════════════════════════════
//  TRICK CENTER AREA with fly animation
// ═══════════════════════════════════════════════════════════
function TrickCenter({ trickPlays, flyingCards=[] }){
  // Card slot positions relative to center div
  const SLOTS = {
    0:{bottom:'0',left:'50%',transform:'translateX(-50%)'},   // you → bottom
    1:{left:'0',top:'50%',transform:'translateY(-50%)'},      // left
    2:{top:'0',left:'50%',transform:'translateX(-50%)'},      // top (north)
    3:{right:'0',top:'50%',transform:'translateY(-50%)'},     // right
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative" style={{width:'280px',height:'200px'}}>
        {/* Felt circle */}
        <div className="absolute inset-0 rounded-full" style={{
          background:'radial-gradient(ellipse,rgba(15,80,40,0.7),rgba(5,40,20,0.4))',
          border:'1px solid rgba(255,255,255,0.06)',
          borderRadius:'50%',
        }}/>
        {trickPlays.map(({seat,card})=>(
          <div key={card.id} className="absolute trick-card" style={SLOTS[seat]}>
            <PlayingCard card={card} size="md" />
          </div>
        ))}
        {flyingCards.map(({cardId,card,fromSeat})=>(
          <div key={cardId} className="absolute trick-flying" style={SLOTS[fromSeat]}>
            {card && <PlayingCard card={card} size="md"/>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MINI SCOREBOARD (live during play - top-left like ref img 2)
// ═══════════════════════════════════════════════════════════
function MiniScoreboard({ gs, totalRounds }){
  const { scores, bids, tricksWon, roundNum, history } = gs;
  return (
    <div className="panel-bg rounded-xl overflow-hidden text-xs" style={{minWidth:'200px'}}>
      <table className="w-full">
        <thead>
          <tr style={{background:'rgba(0,0,0,0.4)'}}>
            <td className="px-2 py-1 text-slate-400 font-bold">R{roundNum}/{totalRounds}</td>
            {[0,1,2,3].map(s=>(
              <td key={s} className={`px-2 py-1 text-center font-black ${s===0?'text-amber-300':'text-slate-300'}`}>
                {PLAYER_NAMES[s]}
              </td>
            ))}
            <td className="px-2 py-1 text-center text-slate-500 font-bold">Σ</td>
          </tr>
        </thead>
        <tbody>
          {/* Current round live */}
          <tr style={{background:'rgba(255,255,255,0.04)'}}>
            <td className="px-2 py-1 text-slate-500">OS</td>
            {[0,1,2,3].map(s=>(
              <td key={s} className={`px-2 py-1 text-center font-bold ${s===0?'text-amber-300':'text-slate-300'}`}>
                {scores[s].toFixed(1)}
              </td>
            ))}
            <td className="px-2 py-1 text-center text-slate-400 font-bold">
              {scores.reduce((a,b)=>a+b,0).toFixed(1)}
            </td>
          </tr>
          {/* Bid/won for current round */}
          <tr style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
            <td className="px-2 py-1 text-slate-500">R{roundNum}</td>
            {[0,1,2,3].map(s=>(
              <td key={s} className="px-2 py-1 text-center">
                <span className={bids[s]!==null ? 'text-cyan-300 font-black' : 'text-slate-600'}>
                  {bids[s]!==null ? `${tricksWon[s]}/${bids[s]}` : '—'}
                </span>
              </td>
            ))}
            <td className="px-2 py-1 text-center text-slate-500">{gs.totalTricks}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SCOREBOARD MODAL (full round history - ref img 1)
// ═══════════════════════════════════════════════════════════
function ScoreboardModal({ gs, totalRounds, onClose }){
  const { history, scores, roundNum } = gs;

  // Projected scores (if all players hit exactly their bid)
  const projected = scores.map((s,i)=>{
    const bid = gs.bids[i];
    const won = gs.tricksWon[i];
    const remaining = 13 - gs.totalTricks;
    const projWon = won + Math.round(remaining * (bid!==null ? bid/13 : 0));
    return parseFloat((s + calcScore(bid||1, projWon)).toFixed(1));
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{background:'rgba(0,0,0,0.75)'}}>
      <div className="bounce-in panel-bg rounded-2xl overflow-hidden shadow-2xl" style={{minWidth:'520px',maxWidth:'90vw'}}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{background:'rgba(139,69,19,0.6)',borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-sm font-bold">Normal</span>
            <span className="text-slate-500 text-xs">·</span>
            <span className="text-slate-300 text-sm font-bold">Bots Mode</span>
            <span className="text-slate-500 text-xs">·</span>
            <span className="text-cyan-300 text-sm font-bold">{totalRounds} Round</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white font-black transition-all">✕</button>
        </div>

        <div className="p-4">
          {/* Column headers */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left py-2 px-2 font-bold">Rounds</th>
                {[0,1,2,3].map(s=>(
                  <th key={s} className={`text-center py-2 px-2 ${s===0?'text-amber-300 font-black':'font-bold'}`}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xl">{PLAYER_AVATARS[s]}</span>
                      <span>{PLAYER_NAMES[s]}</span>
                      <span className="text-[10px] text-slate-500">{SUIT_SYM.S}</span>
                    </div>
                  </th>
                ))}
                <th className="text-center py-2 px-2 text-slate-500 font-bold">Sum</th>
              </tr>
            </thead>
            <tbody>
              {/* History rows */}
              {history.map((row,i)=>(
                <tr key={i} style={{borderTop:'1px dashed rgba(255,255,255,0.08)'}}>
                  <td className="px-2 py-2 text-slate-400 font-bold">(R{row.roundNum})</td>
                  {[0,1,2,3].map(s=>(
                    <td key={s} className="px-2 py-2 text-center">
                      <span className={`font-bold ${row.roundScores[s]>=0?'text-green-300':'text-red-400'}`}>
                        {row.tricksWon[s]} / {row.bids[s]}
                      </span>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-slate-400 font-bold">
                    {row.bids.reduce((a,b)=>a+(b||0),0)}
                  </td>
                </tr>
              ))}

              {/* Overall score row */}
              <tr style={{borderTop:'2px solid rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.03)'}}>
                <td className="px-2 py-2 text-white font-black">Overall Score</td>
                {[0,1,2,3].map(s=>(
                  <td key={s} className={`px-2 py-2 text-center font-black text-base ${s===0?'text-amber-300':'text-slate-200'}`}>
                    {scores[s].toFixed(1)}
                  </td>
                ))}
                <td className="px-2 py-2 text-center text-slate-400 font-bold">{scores.reduce((a,b)=>a+b,0).toFixed(1)}</td>
              </tr>

              {/* Projected score row */}
              {gs.phase===PHASE.PLAYING&&(
                <tr style={{borderTop:'1px solid rgba(255,255,255,0.08)'}}>
                  <td className="px-2 py-2 text-slate-500 italic text-xs">Projected</td>
                  {[0,1,2,3].map(s=>(
                    <td key={s} className="px-2 py-2 text-center text-slate-500 text-xs italic">{projected[s].toFixed(1)}</td>
                  ))}
                  <td/>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  ROUND END LEADERBOARD
// ═══════════════════════════════════════════════════════════
function RoundEndLeaderboard({ gs, totalRounds, onNext }){
  const { roundScores, scores, tricksWon, bids, trump, auctionWinner, roundNum } = gs;
  const sorted = [0,1,2,3].map(s=>({s,score:scores[s]})).sort((a,b)=>b.score-a.score);
  const medals = ['🥇','🥈','🥉',''];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{background:'rgba(0,0,0,0.8)'}}>
      <div className="bounce-in panel-bg rounded-2xl overflow-hidden shadow-2xl" style={{minWidth:'480px',maxWidth:'92vw'}}>
        {/* Header */}
        <div className="text-center py-4 px-6" style={{background:'linear-gradient(135deg,rgba(139,69,19,0.6),rgba(100,40,10,0.6))'}}>
          <div className="cb-title text-amber-400 text-3xl font-bold">Round {roundNum} Complete!</div>
          <div className="text-slate-400 text-sm mt-1">
            Trump was <span className={`font-black ${SUIT_RED[trump]?'text-red-400':'text-slate-200'}`}>{SUIT_SYM[trump]} {SUIT_NAMES[trump]}</span>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="p-4 space-y-2">
          {sorted.map(({s},rank)=>{
            const bidMet = tricksWon[s] >= (bids[s]||0);
            return (
              <div key={s} className={`flex items-center gap-3 p-3 rounded-xl ${s===0?'ring-1 ring-amber-400/40':''}`}
                style={{background:rank===0?'rgba(251,191,36,0.12)':'rgba(255,255,255,0.04)'}}>
                <span className="text-2xl w-8">{medals[rank]}</span>
                <span className="text-2xl">{PLAYER_AVATARS[s]}</span>
                <div className="flex-1">
                  <div className={`font-black text-sm ${s===0?'text-amber-300':'text-slate-200'}`}>
                    {PLAYER_NAMES[s]} {s===auctionWinner&&<span className="text-amber-400 text-xs">★ Auction</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    Bid {bids[s]??'—'} · Won {tricksWon[s]}
                    {s===auctionWinner&&<span className="text-amber-500 ml-1">(Locked)</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-black text-lg ${roundScores[s]>=0?'text-green-400':'text-red-400'}`}>
                    {roundScores[s]>0?'+':''}{roundScores[s]}
                  </div>
                  <div className={`text-xs font-bold ${bidMet?'text-green-500':'text-red-500'}`}>
                    {bidMet?'✓ Made bid':'✗ Failed'}
                  </div>
                </div>
                <div className="text-right ml-2">
                  <div className="text-white font-black text-base">{scores[s].toFixed(1)}</div>
                  <div className="text-slate-500 text-xs">total</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 pb-4">
          <button onClick={onNext}
            className="w-full py-3 rounded-xl font-black text-base text-black transition-all active:scale-95"
            style={{background:'linear-gradient(135deg,#fbbf24,#f59e0b)',boxShadow:'0 4px 16px rgba(251,191,36,0.3)'}}>
            {roundNum >= totalRounds ? '🏆 Final Results' : `Next Round (${roundNum+1}/${totalRounds}) →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  GAME OVER SCREEN
// ═══════════════════════════════════════════════════════════
function GameOverScreen({ gs, onRestart }){
  const { scores } = gs;
  const sorted = [0,1,2,3].map(s=>({s,score:scores[s]})).sort((a,b)=>b.score-a.score);
  const medals = ['🥇','🥈','🥉','4️⃣'];
  const winner = sorted[0];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{background:'rgba(0,0,0,0.9)'}}>
      <div className="bounce-in text-center" style={{maxWidth:'400px',width:'90vw'}}>
        <div className="text-6xl mb-4">{winner.s===0?'🎉':'😔'}</div>
        <div className="cb-title text-amber-400 text-4xl font-bold mb-1">
          {winner.s===0 ? 'You Won!' : `${PLAYER_NAMES[winner.s]} Wins!`}
        </div>
        <div className="text-slate-400 mb-6">Final Standings</div>
        <div className="panel-bg rounded-2xl p-4 space-y-2 mb-6">
          {sorted.map(({s},rank)=>(
            <div key={s} className={`flex items-center gap-3 p-2 rounded-xl ${s===0?'bg-amber-400/10':''}`}>
              <span className="text-2xl">{medals[rank]}</span>
              <span className="text-xl">{PLAYER_AVATARS[s]}</span>
              <span className={`flex-1 text-left font-bold ${s===0?'text-amber-300':'text-slate-300'}`}>{PLAYER_NAMES[s]}</span>
              <span className={`font-black text-lg ${scores[s]>=0?'text-green-400':'text-red-400'}`}>{scores[s].toFixed(1)}</span>
            </div>
          ))}
        </div>
        <button onClick={onRestart}
          className="px-8 py-3 rounded-xl font-black text-black text-lg active:scale-95"
          style={{background:'linear-gradient(135deg,#fbbf24,#f59e0b)'}}>
          Play Again
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  AUCTION PANEL
// ═══════════════════════════════════════════════════════════
function AuctionPanel({ gs, onBid, onPass, onSkip }){
  const [bidVal,setBidVal] = useState(5);
  const [suit,setSuit] = useState('S');
  const [skipConfirm,setSkipConfirm] = useState(false);
  const {auction} = gs;
  const isFirst = auction.highestBidder===null;
  const minBid = isFirst?5:auction.highestBid+1;
  const isMyTurn = auction.currentBidder===0&&!auction.done;
  const canSkip = isMyTurn&&isFirst;
  useEffect(()=>setBidVal(minBid),[minBid]);

  return (
    <div className="fade-slide panel-bg rounded-2xl p-4 shadow-2xl" style={{width:'320px'}}>
      <div className="text-center mb-3">
        <div className="cb-title text-amber-400 text-2xl font-bold">⚡ Trump Auction</div>
        <div className="text-slate-500 text-xs">First bid ≥ 5 · Must bid higher to overtake</div>
      </div>

      {/* Bid history */}
      <div className="space-y-1 mb-3" style={{maxHeight:'96px',overflowY:'auto'}}>
        {!auction.bids.length&&<div className="text-slate-600 text-xs text-center italic py-1">Auction not started</div>}
        {auction.bids.map((b,i)=>(
          <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg" style={{background:b.bid?'rgba(251,191,36,0.08)':'rgba(255,255,255,0.03)'}}>
            <span>{PLAYER_AVATARS[b.seat]}</span>
            <span className="text-slate-400">{PLAYER_NAMES[b.seat]}</span>
            {b.bid
              ?<span className="ml-auto text-amber-400 font-black">Bid {b.bid} for unknown color</span>
              :<span className="ml-auto text-slate-600 italic">Passed</span>}
          </div>
        ))}
      </div>

      {auction.highestBid>4&&(
        <div className="text-center text-xs text-slate-500 mb-2 px-2 py-1 rounded-lg" style={{background:'rgba(255,255,255,0.04)'}}>
          Leading: <span className="text-amber-400 font-black">{auction.highestBid}</span> by {PLAYER_NAMES[auction.highestBidder]??'—'}
        </div>
      )}

      {isMyTurn ? (
        skipConfirm?(
          <div className="space-y-2">
            <div className="text-center p-3 rounded-xl" style={{background:'rgba(255,255,255,0.05)'}}>
              <div className="text-3xl mb-1">♠</div>
              <div className="text-white font-bold text-sm">Skip auction?</div>
              <div className="text-slate-400 text-xs mt-1">Spades will be default trump</div>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{setSkipConfirm(false);onSkip();}} className="flex-1 py-2 rounded-xl font-bold text-sm text-slate-300 transition-all" style={{background:'rgba(100,100,100,0.3)'}}>Yes, use ♠</button>
              <button onClick={()=>setSkipConfirm(false)} className="flex-1 py-2 rounded-xl font-bold text-sm text-slate-400 border border-white/10 transition-all">Go back</button>
            </div>
          </div>
        ):(
          <div className="space-y-2">
            {/* Stepper */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{background:'rgba(0,0,0,0.3)'}}>
              <button onClick={()=>setBidVal(v=>Math.max(minBid,v-1))} className="w-8 h-8 rounded-full font-black text-white text-lg flex items-center justify-center transition-all" style={{background:'rgba(255,255,255,0.1)'}}>−</button>
              <span className="flex-1 text-center text-3xl font-black text-white cb-title">{bidVal}</span>
              <button onClick={()=>setBidVal(v=>Math.min(13,v+1))} className="w-8 h-8 rounded-full font-black text-white text-lg flex items-center justify-center transition-all" style={{background:'rgba(255,255,255,0.1)'}}>+</button>
            </div>
            {/* Suit grid */}
            <div className="grid grid-cols-4 gap-1">
              {SUITS.map(s=>(
                <button key={s} onClick={()=>setSuit(s)}
                  className="py-2 rounded-xl text-2xl font-bold transition-all"
                  style={suit===s?{background:'rgba(251,191,36,0.2)',border:'2px solid rgba(251,191,36,0.8)'}:{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <span style={{color:SUIT_RED[s]?'#f87171':'#e2e8f0'}}>{SUIT_SYM[s]}</span>
                </button>
              ))}
            </div>
            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={()=>onBid(bidVal,suit)} className="flex-1 py-2.5 rounded-xl font-black text-black text-sm active:scale-95 transition-all" style={{background:'linear-gradient(135deg,#fbbf24,#f59e0b)'}}>
                BID {bidVal} · {SUIT_SYM[suit]}
              </button>
              {!isFirst&&<button onClick={onPass} className="px-4 py-2.5 rounded-xl font-bold text-slate-400 text-sm active:scale-95 transition-all border border-white/10" style={{background:'rgba(0,0,0,0.3)'}}>Pass</button>}
            </div>
            {canSkip&&<button onClick={()=>setSkipConfirm(true)} className="w-full py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-400 transition-all border border-white/5">♠ Skip · play with Spades default</button>}
          </div>
        )
      ):(
        <div className="text-center py-3 text-slate-400 text-sm animate-pulse">
          {auction.done?'✓ Auction complete':`${PLAYER_NAMES[auction.currentBidder]} is thinking…`}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  BIDDING PANEL (What's your call? - ref img 3)
// ═══════════════════════════════════════════════════════════
function BiddingPanel({ gs, onBid }){
  const [val,setVal] = useState(1);
  const { bids, trump } = gs;
  const isMyTurn = bids[0]===null;

  return (
    <div className="fade-slide panel-bg rounded-2xl shadow-2xl overflow-hidden" style={{width:'340px'}}>
      <div className="px-5 pt-4 pb-2">
        <div className="text-white font-black text-xl mb-1">What's your call?</div>
        <div className="text-xs text-slate-500 mb-3">Trump: <span style={{color:SUIT_RED[trump]?'#f87171':'#e2e8f0',fontWeight:900}}>{SUIT_SYM[trump]} {SUIT_NAMES[trump]}</span></div>

        {/* Other players' bids */}
        <div className="grid grid-cols-3 gap-1 mb-3">
          {[1,2,3].map(s=>(
            <div key={s} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs" style={{background:'rgba(255,255,255,0.04)'}}>
              <span>{PLAYER_AVATARS[s]}</span>
              <span className="text-slate-400">{PLAYER_NAMES[s]}</span>
              <span className="ml-auto font-black text-cyan-300">{bids[s]!==null?bids[s]:'—'}</span>
            </div>
          ))}
        </div>

        {isMyTurn ? (
          <>
            {/* Number row like reference screenshot */}
            <div className="flex justify-between mb-2 px-1">
              {[1,2,3,4,5,6,7,8].map(n=>(
                <button key={n} onClick={()=>setVal(n)}
                  className="text-sm font-black transition-all"
                  style={{color:val===n?'#fbbf24':'#94a3b8',textShadow:val===n?'0 0 8px rgba(251,191,36,0.8)':'none'}}>
                  {n}
                </button>
              ))}
            </div>
            {/* Slider bar */}
            <div className="relative h-3 rounded-full mb-3" style={{background:'rgba(255,255,255,0.1)'}}>
              <div className="absolute top-0 left-0 h-full rounded-full transition-all" style={{width:`${(val/8)*100}%`,background:'linear-gradient(90deg,#7c2d12,#c2410c,#fbbf24)'}}/>
              <input type="range" min={1} max={8} value={val} onChange={e=>setVal(+e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" style={{WebkitAppearance:'none'}}/>
              <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-amber-400 transition-all"
                style={{left:`calc(${(val/8)*100}% - 10px)`,background:'#fbbf24',boxShadow:'0 0 8px rgba(251,191,36,0.8)'}}/>
            </div>
            {/* Stepper + confirm */}
            <div className="flex items-center gap-3">
              <button onClick={()=>setVal(v=>Math.max(1,v-1))} className="w-10 h-10 rounded-xl font-black text-white text-xl flex items-center justify-center" style={{background:'rgba(139,69,19,0.6)'}}>−</button>
              <span className="flex-1 text-center text-4xl font-black text-white cb-title">{val}</span>
              <button onClick={()=>setVal(v=>Math.min(8,v+1))} className="w-10 h-10 rounded-xl font-black text-white text-xl flex items-center justify-center" style={{background:'rgba(139,69,19,0.6)'}}>+</button>
              <button onClick={()=>onBid(val)} className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-black" style={{background:'#16a34a',boxShadow:'0 4px 12px rgba(22,163,74,0.4)'}}>✓</button>
            </div>
          </>
        ):(
          <div className="text-center py-2">
            <span className="text-slate-400 text-sm">Your bid: </span>
            <span className="text-amber-300 font-black text-2xl cb-title">{bids[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  TRUMP REVEAL
// ═══════════════════════════════════════════════════════════
function TrumpReveal({ trump, winner }){
  return (
    <div className="bounce-in panel-bg rounded-2xl p-6 text-center shadow-2xl" style={{minWidth:'200px'}}>
      <div className="text-7xl mb-2" style={{color:SUIT_RED[trump]?'#f87171':'#e2e8f0',filter:'drop-shadow(0 0 20px currentColor)'}}>
        {SUIT_SYM[trump]}
      </div>
      <div className="cb-title text-amber-400 text-2xl font-bold">Power Color!</div>
      <div className="text-white font-black text-lg">{SUIT_NAMES[trump]}</div>
      <div className="text-slate-500 text-xs mt-1">
        {winner!==null?`Revealed by ${PLAYER_NAMES[winner]}`:'Default trump'}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  HUMAN HAND with swipe-to-play
// ═══════════════════════════════════════════════════════════
function HumanHand({ hand, phase, currentSeat, trump, trickPlays, leadSuit, onPlay, sorted, onToggleSort }){
  const [selected,setSelected] = useState(null);
  const [swipeStart,setSwipeStart] = useState(null);
  const [swipeDelta,setSwipeDelta] = useState({});
  const isMyTurn = phase===PHASE.PLAYING && currentSeat===0;

  const legal = isMyTurn ? getLegal(hand,trickPlays,leadSuit,trump) : [];
  const isPlayable = c => legal.some(l=>l.id===c.id);

  useEffect(()=>{ setSelected(null); },[currentSeat]);

  const handlePlay = c => {
    if(!isMyTurn||!isPlayable(c)) return;
    if(selected?.id===c.id){ onPlay(c); setSelected(null); }
    else setSelected(c);
  };

  // Swipe up to play
  const onTouchStart = (c,e) => {
    if(!isMyTurn||!isPlayable(c)) return;
    setSwipeStart({id:c.id,y:e.touches[0].clientY});
    setSelected(c);
  };
  const onTouchMove = (c,e) => {
    if(!swipeStart||swipeStart.id!==c.id) return;
    const dy = swipeStart.y - e.touches[0].clientY;
    if(dy>0) setSwipeDelta(d=>({...d,[c.id]:dy}));
  };
  const onTouchEnd = (c) => {
    const dy = swipeDelta[c.id]||0;
    if(dy>40&&isPlayable(c)){ onPlay(c); setSelected(null); setSwipeDelta({}); setSwipeStart(null); return; }
    setSwipeDelta({}); setSwipeStart(null);
  };

  const displayHand = sorted ? autoSort(hand, trump) : hand;
  const cardW = 54, gap = Math.min(16, Math.max(4, (window.innerWidth*0.9 - cardW) / Math.max(hand.length-1,1)));

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        {isMyTurn && <span className="text-amber-300 text-sm font-black animate-pulse">● Your Turn</span>}
        <button onClick={onToggleSort}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold transition-all"
          style={sorted?{background:'rgba(34,211,238,0.15)',border:'1px solid rgba(34,211,238,0.5)',color:'#67e8f9'}:{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#94a3b8'}}>
          <SortAsc className="w-3 h-3"/>♠♥♦♣
        </button>
        {selected&&isMyTurn&&<span className="text-slate-400 text-xs">Tap again or swipe up to play</span>}
      </div>

      {/* Overlapping fan hand */}
      <div className="relative" style={{height:'92px',width:Math.min(window.innerWidth*0.9, cardW+(displayHand.length-1)*gap+8)+'px'}}>
        {displayHand.map((card,i)=>{
          const swipeY = swipeDelta[card.id]||0;
          const isSelected = selected?.id===card.id;
          const playable = isPlayable(card);
          return (
            <div key={card.id}
              className="absolute transition-all"
              style={{
                left:`${i*gap}px`, bottom:0, zIndex:isSelected?50:i,
                transform:`translateY(${isSelected?-(16+Math.min(swipeY,40)):-Math.min(swipeY,10)}px)`,
                filter:isMyTurn&&!playable?'brightness(0.45)':'none',
              }}
              onClick={()=>handlePlay(card)}
              onTouchStart={e=>onTouchStart(card,e)}
              onTouchMove={e=>onTouchMove(card,e)}
              onTouchEnd={()=>onTouchEnd(card)}>
              <PlayingCard card={card} size="lg"
                selected={isSelected}
                legal={!isMyTurn||playable}
                animDelay={i*30}/>
              {isSelected&&isMyTurn&&<div className="absolute -top-5 left-1/2 -translate-x-1/2 text-amber-400 text-xs animate-bounce">↑</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MAIN MENU  (ref img 4 style)
// ═══════════════════════════════════════════════════════════
function MainMenu({ onStart, totalRounds, setTotalRounds }){
  return (
    <div className="wood-bg w-full h-full flex flex-col items-center justify-center relative">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 z-10" style={{background:'rgba(0,0,0,0.3)'}}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-amber-400">
            <div className="w-full h-full bg-slate-700 flex items-center justify-center text-lg">🧑</div>
          </div>
          <div>
            <div className="text-white font-black text-sm">Player</div>
            <div className="text-amber-400 text-xs font-bold flex items-center gap-1">0 💎</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-300 text-xs font-bold">
          <Users className="w-4 h-4"/>
          <span>6,596 Online</span>
          <span className="text-slate-500">·</span>
          <span className="text-green-400">66ms</span>
        </div>
        <div className="flex gap-2">
          <button className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'rgba(139,69,19,0.7)'}}><Settings className="w-4 h-4 text-white"/></button>
        </div>
      </div>

      {/* Title */}
      <div className="mb-8 text-center">
        <div className="cb-title text-amber-400 font-bold" style={{fontSize:'52px',textShadow:'0 0 40px rgba(251,191,36,0.5)',lineHeight:1}}>CALL BREAK</div>
        <div className="text-slate-400 text-sm tracking-widest uppercase mt-1">Professional Edition</div>
        <div className="flex justify-center gap-3 mt-2 text-2xl" style={{filter:'drop-shadow(0 0 8px rgba(251,191,36,0.4))'}}>♠ <span className="text-red-400">♥</span> <span className="text-red-400">♦</span> ♣</div>
      </div>

      {/* Mode buttons (2×2 grid like ref img 4) */}
      <div className="grid grid-cols-2 gap-4 mb-6" style={{maxWidth:'480px',width:'90%'}}>
        {[
          {label:'Play Bots',icon:'🤖',count:'4,391',active:true},
          {label:'Play Online',icon:'👤',count:'1,651',active:false},
          {label:'Play Private',icon:'🃏',count:'312',active:false},
          {label:'Play Locally',icon:'📶',count:'6',active:false},
        ].map(({label,icon,count,active})=>(
          <button key={label} onClick={active?()=>onStart('bot'):undefined}
            className="relative flex flex-col items-center justify-center gap-2 rounded-2xl py-6 transition-all active:scale-95"
            style={{
              background:active?'linear-gradient(145deg,#8B3A0F,#6B2A08)':'rgba(60,25,8,0.7)',
              border:active?'2px solid rgba(251,191,36,0.3)':'2px solid rgba(255,255,255,0.05)',
              boxShadow:active?'0 4px 24px rgba(139,69,19,0.5)':'none',
              cursor:active?'pointer':'not-allowed',
              opacity:active?1:0.6,
            }}>
            {!active&&<span className="absolute top-2 right-2 text-[10px] bg-slate-700/70 text-slate-400 px-1.5 py-0.5 rounded-full">Soon</span>}
            <span className="text-4xl">{icon}</span>
            <span className="text-white font-black text-base">{label}</span>
            <span className="flex items-center gap-1 text-slate-400 text-xs"><Users className="w-3 h-3"/>{count}</span>
          </button>
        ))}
      </div>

      {/* Rounds selector */}
      <div className="flex items-center gap-3">
        <span className="text-slate-400 text-sm font-bold">Rounds:</span>
        {[3,5,7,10].map(n=>(
          <button key={n} onClick={()=>setTotalRounds(n)}
            className="w-9 h-9 rounded-full font-black text-sm transition-all"
            style={totalRounds===n?{background:'#fbbf24',color:'#1c0a00'}:{background:'rgba(255,255,255,0.08)',color:'#94a3b8',border:'1px solid rgba(255,255,255,0.1)'}}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  GAME TABLE (landscape - ref img 2 layout)
// ═══════════════════════════════════════════════════════════
function GameTable({ gs, totalRounds, onCardPlay, onAuctionBid, onAuctionPass, onSkipAuction, onBid, onNext, onBack, sortedHand, onToggleSort }){
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [flyCards, setFlyCards] = useState([]);
  const trickPlays = gs.trickPlays||[];

  // When trick completes (4 cards), animate cards flying to winner
  const prevTotalTricks = useRef(gs.totalTricks);
  useEffect(()=>{
    if(gs.totalTricks>prevTotalTricks.current && trickPlays.length===4){
      // briefly show fly animation then clear
      setFlyCards([...trickPlays]);
      setTimeout(()=>setFlyCards([]),900);
    }
    prevTotalTricks.current = gs.totalTricks;
  },[gs.totalTricks]);

  const isPlaying = gs.phase===PHASE.PLAYING;
  const trump = gs.trump;

  return (
    <div className="wood-bg w-full h-full relative overflow-hidden">
      {/* ── Table felt area ── */}
      <div className="felt-bg absolute" style={{left:'22%',right:'0',top:'0',bottom:'22%',borderBottomLeftRadius:'48px'}}>

        {/* Opponent seats */}
        <PlayerSeat seat={2} position="top"   hand={gs.hands[2]} isActive={gs.currentSeat===2}
          bid={gs.bids[2]} tricksWon={gs.tricksWon[2]} isDealer={gs.dealer===2}
          auctionWinner={gs.auctionWinner===2}/>
        <PlayerSeat seat={1} position="left"  hand={gs.hands[1]} isActive={gs.currentSeat===1}
          bid={gs.bids[1]} tricksWon={gs.tricksWon[1]} isDealer={gs.dealer===1}
          auctionWinner={gs.auctionWinner===1}/>
        <PlayerSeat seat={3} position="right" hand={gs.hands[3]} isActive={gs.currentSeat===3}
          bid={gs.bids[3]} tricksWon={gs.tricksWon[3]} isDealer={gs.dealer===3}
          auctionWinner={gs.auctionWinner===3}/>

        {/* Trick center */}
        {isPlaying && <TrickCenter trickPlays={trickPlays} flyingCards={flyCards.length?flyCards:[]}/>}

        {/* Phase overlays */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            {gs.phase===PHASE.AUCTION && <AuctionPanel gs={gs} onBid={onAuctionBid} onPass={onAuctionPass} onSkip={onSkipAuction}/>}
            {gs.phase===PHASE.REVEAL  && <TrumpReveal trump={gs.trump} winner={gs.auctionWinner}/>}
            {gs.phase===PHASE.BIDDING && <BiddingPanel gs={gs} onBid={onBid}/>}
          </div>
        </div>

        {/* Trump badge */}
        {trump&&isPlaying&&(
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full text-sm font-black" style={{background:'rgba(0,0,0,0.6)',border:'1px solid rgba(251,191,36,0.4)',color:SUIT_RED[trump]?'#f87171':'#e2e8f0'}}>
            {SUIT_SYM[trump]} Trump
          </div>
        )}

        {/* "Your Turn" toast */}
        {isPlaying&&gs.currentSeat===0&&(
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 fade-slide px-4 py-2 rounded-full text-sm font-black text-black" style={{background:'#fbbf24',boxShadow:'0 4px 16px rgba(251,191,36,0.5)'}}>
            Your Turn
          </div>
        )}
      </div>

      {/* ── Mini scoreboard (top-left like ref img 2) ── */}
      <div className="absolute top-2 left-2 z-20">
        <MiniScoreboard gs={gs} totalRounds={totalRounds}/>
      </div>

      {/* ── Top-right controls (ref img 2) ── */}
      <div className="absolute top-2 right-2 flex gap-2 z-20">
        <button onClick={()=>setShowScoreboard(true)}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white transition-all"
          style={{background:'rgba(139,69,19,0.8)',border:'1px solid rgba(255,255,255,0.1)'}}>
          <Trophy className="w-5 h-5"/>
        </button>
        <button onClick={onBack}
          className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white transition-all"
          style={{background:'rgba(139,69,19,0.8)',border:'1px solid rgba(255,255,255,0.1)'}}>
          <ChevronLeft className="w-5 h-5"/>
        </button>
        <button className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white transition-all"
          style={{background:'rgba(139,69,19,0.8)',border:'1px solid rgba(255,255,255,0.1)'}}>
          <Settings className="w-5 h-5"/>
        </button>
      </div>

      {/* ── You seat label + bottom hand area ── */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center" style={{paddingBottom:'8px',paddingLeft:'22%'}}>
        {/* You badge */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black
            ${gs.currentSeat===0?'bg-amber-400/25 border border-amber-400/70 text-amber-200 pulse-active':'bg-black/60 border border-white/10 text-slate-300'}`}>
            {gs.dealer===0&&<span className="text-xs bg-amber-500 text-black rounded-full w-4 h-4 flex items-center justify-center font-black">D</span>}
            <span>🧑 You</span>
            {gs.bids[0]!==null&&<span className="text-cyan-300">·{gs.bids[0]}</span>}
            {gs.tricksWon[0]>0&&<span className="text-green-300">·{gs.tricksWon[0]}✓</span>}
            {gs.auctionWinner===0&&<span className="text-amber-300">★</span>}
          </div>
          {gs.scores[0]!==undefined&&<span className="text-amber-400 text-xs font-black">{gs.scores[0].toFixed(1)} pts</span>}
        </div>

        <HumanHand
          hand={gs.hands[0]||[]}
          phase={gs.phase}
          currentSeat={gs.currentSeat}
          trump={gs.trump}
          trickPlays={trickPlays}
          leadSuit={gs.leadSuit}
          onPlay={onCardPlay}
          sorted={sortedHand}
          onToggleSort={onToggleSort}
        />
      </div>

      {/* Game log pill (bottom-right) */}
      <div className="absolute bottom-2 right-2 z-20">
        {gs.log.slice(-1).map((l,i)=>(
          <div key={gs.log.length} className="fade-slide text-xs text-slate-400 px-2 py-1 rounded-full" style={{background:'rgba(0,0,0,0.6)',border:'1px solid rgba(255,255,255,0.05)',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {l}
          </div>
        ))}
      </div>

      {/* Scoreboard modal */}
      {showScoreboard&&<ScoreboardModal gs={gs} totalRounds={totalRounds} onClose={()=>setShowScoreboard(false)}/>}

      {/* Round end leaderboard */}
      {gs.phase===PHASE.ROUND_END&&<RoundEndLeaderboard gs={gs} totalRounds={totalRounds} onNext={onNext}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  GAME STORE HOOK
// ═══════════════════════════════════════════════════════════
function useGameStore(totalRounds){
  const [screen, setScreen] = useState('menu');
  const [gs, setGs] = useState(null);
  const [sortedHand, setSortedHand] = useState(false);
  const timer = useRef();
  const addLog = (s,msg)=>({...s,log:[...s.log,msg]});

  const startGame = useCallback(()=>{
    setGs(initRound(0,[0,0,0,0],1));
    setScreen('game');
  },[]);
  const goMenu = useCallback(()=>{ clearTimeout(timer.current); setScreen('menu'); setGs(null); },[]);

  // ── Auction helpers ──
  function nextAIBidder(a){
    const ci=CCW.indexOf(a.currentBidder);
    for(let i=1;i<=4;i++){ const c=CCW[(ci+i)%4]; if(c!==a.highestBidder&&!a.passedSeats.has(c))return c; }
    return a.highestBidder??0;
  }
  function auctionDone(a){
    if(a.highestBidder===null)return false;
    return [0,1,2,3].filter(s=>s!==a.highestBidder&&!a.passedSeats.has(s)).length===0;
  }

  const runAIAuction = useCallback((state)=>{
    const {auction:a0}=state;
    if(a0.done||a0.currentBidder===0)return state;
    const seat=a0.currentBidder, isFirst=a0.highestBidder===null;
    const d=aiBidAuction(state.hands[seat],a0.highestBid,isFirst);
    const a={...a0,bids:[...a0.bids],passedSeats:new Set(a0.passedSeats)};
    if(d.action==='bid'){
      a.highestBid=d.bid;a.highestBidder=seat;a.chosenSuit=d.suit;
      a.bids.push({seat,bid:d.bid,suit:d.suit});
      a.currentBidder=nextAIBidder(a);a.done=auctionDone(a);
      return addLog({...state,auction:a},`${PLAYER_NAMES[seat]} bids ${d.bid} for a new color`);
    } else {
      a.passedSeats.add(seat);a.bids.push({seat,bid:null,suit:null});
      a.currentBidder=nextAIBidder(a);a.done=auctionDone(a);
      return addLog({...state,auction:a},`${PLAYER_NAMES[seat]} passes`);
    }
  },[]);

  // ── Auction FSM effect ──
  useEffect(()=>{
    if(!gs||gs.phase!==PHASE.AUCTION)return;
    const {auction}=gs;
    if(auction.done){
      const trump=auction.highestBidder!==null?auction.chosenSuit:'S', winner=auction.highestBidder;
      timer.current=setTimeout(()=>{
        setGs(s=>{ if(!s||s.phase!==PHASE.AUCTION)return s; return addLog({...s,phase:PHASE.REVEAL,trump,auctionWinner:winner},`Auction over! Trump: ${SUIT_NAMES[trump]}`); });
      },700);
      return;
    }
    if(auction.currentBidder!==0){
      timer.current=setTimeout(()=>{
        setGs(s=>{ if(!s||s.phase!==PHASE.AUCTION)return s; return runAIAuction(s); });
      },950);
    }
    return ()=>clearTimeout(timer.current);
  },[gs?.phase,gs?.auction?.currentBidder,gs?.auction?.done]);

  // ── Reveal → Bidding ──
  useEffect(()=>{
    if(!gs||gs.phase!==PHASE.REVEAL)return;
    timer.current=setTimeout(()=>{
      setGs(s=>{
        if(!s||s.phase!==PHASE.REVEAL)return s;
        const {hands:nh,remaining}=dealN(s.remaining,s.hands,8);
        const stamped=stampTrump(nh,s.trump);
        const bids=[...s.bids];
        if(s.auctionWinner!==null)bids[s.auctionWinner]=s.auction.highestBid;
        let ns={...s,phase:PHASE.BIDDING,hands:stamped,remaining,bids};
        ns=addLog(ns,'Cards dealt! Place your bids.');
        [1,2,3].forEach(seat=>{
          if(seat!==s.auctionWinner){ bids[seat]=aiStdBid(stamped[seat],s.trump); ns=addLog(ns,`${PLAYER_NAMES[seat]} bids ${bids[seat]}`); }
        });
        if(s.auctionWinner!==0)bids[0]=null;
        ns.bids=bids;
        if(s.auctionWinner===0)ns=addLog(ns,`Your auction bid of ${s.auction.highestBid} is locked.`);
        if(ns.bids.every(b=>b!==null))ns=startPlayingFn(ns);
        return ns;
      });
    },2000);
    return ()=>clearTimeout(timer.current);
  },[gs?.phase]);

  const placeBid=useCallback((val)=>{
    setGs(s=>{
      if(!s||s.phase!==PHASE.BIDDING||s.bids[0]!==null)return s;
      const bids=[...s.bids]; bids[0]=val;
      let ns=addLog({...s,bids},`You bid ${val}`);
      if(ns.bids.every(b=>b!==null))ns=startPlayingFn(ns);
      return ns;
    });
  },[]);

  function startPlayingFn(s){
    const di=CCW.indexOf(s.dealer); const first=CCW[(di+1)%4];
    return addLog({...s,phase:PHASE.PLAYING,trickPlays:[],leadSuit:null,leadSeat:first,currentSeat:first},`Play begins! ${PLAYER_NAMES[first]} leads.`);
  }

  // ── AI card play ──
  useEffect(()=>{
    if(!gs||gs.phase!==PHASE.PLAYING||gs.currentSeat===0)return;
    timer.current=setTimeout(()=>{
      setGs(s=>{
        if(!s||s.phase!==PHASE.PLAYING||s.currentSeat===0)return s;
        const seat=s.currentSeat;
        const card=aiCard(s.hands[seat],s.trickPlays,s.leadSuit,s.trump);
        return playCardFn(s,seat,card);
      });
    },750);
    return ()=>clearTimeout(timer.current);
  },[gs?.phase,gs?.currentSeat,gs?.trickPlays?.length]);

  function playCardFn(s,seat,card){
    const newTrick=[...s.trickPlays,{seat,card}];
    const newHands=s.hands.map((h,i)=>i===seat?h.filter(c=>c.id!==card.id):h);
    const leadSuit=s.leadSuit??card.suit;
    let ns=addLog({...s,trickPlays:newTrick,hands:newHands,leadSuit},`${PLAYER_NAMES[seat]} plays ${card.rank}${SUIT_SYM[card.suit]}`);

    if(newTrick.length===4){
      const winner=trickWinner(newTrick,leadSuit,s.trump);
      const won=[...s.tricksWon]; won[winner]++;
      const total=s.totalTricks+1;
      ns=addLog(ns,`${PLAYER_NAMES[winner]} wins the trick! (${won[winner]})`);
      if(total===13){
        const roundScores=s.bids.map((b,i)=>calcScore(b,won[i]));
        const scores=s.scores.map((sc,i)=>parseFloat((sc+roundScores[i]).toFixed(1)));
        // Save to history
        const histEntry={roundNum:s.roundNum,bids:[...s.bids],tricksWon:won,roundScores,trump:s.trump};
        return addLog({...ns,phase:PHASE.ROUND_END,tricksWon:won,trickPlays:[],leadSuit:null,roundScores,scores,totalTricks:total,history:[...(s.history||[]),histEntry]},'Round complete!');
      } else {
        setTimeout(()=>setGs(prev=>{
          if(!prev||prev.phase!==PHASE.PLAYING)return prev;
          return {...prev,trickPlays:[],leadSuit:null,leadSeat:winner,currentSeat:winner,tricksWon:won,totalTricks:total};
        }),1100);
        return {...ns,tricksWon:won,totalTricks:total};
      }
    } else {
      return {...ns,currentSeat:ccwNext(seat)};
    }
  }

  const humanPlay=useCallback((card)=>{
    setGs(s=>{ if(!s||s.phase!==PHASE.PLAYING||s.currentSeat!==0)return s; return playCardFn(s,0,card); });
  },[]);

  const humanAuctionBid=useCallback((bid,suit)=>{
    setGs(s=>{
      if(!s||s.phase!==PHASE.AUCTION||s.auction.currentBidder!==0)return s;
      const a={...s.auction,bids:[...s.auction.bids],passedSeats:new Set(s.auction.passedSeats)};
      const min=a.highestBidder===null?5:a.highestBid+1; if(bid<min)return s;
      a.highestBid=bid;a.highestBidder=0;a.chosenSuit=suit;a.bids.push({seat:0,bid,suit});
      a.currentBidder=nextAIBidder(a);a.done=auctionDone(a);
      return addLog({...s,auction:a},`You bid ${bid} for a new color`);
    });
  },[]);

  const humanAuctionPass=useCallback(()=>{
    setGs(s=>{
      if(!s||s.phase!==PHASE.AUCTION||s.auction.currentBidder!==0)return s;
      if(s.auction.highestBidder===null)return s;
      const a={...s.auction,bids:[...s.auction.bids],passedSeats:new Set(s.auction.passedSeats)};
      a.passedSeats.add(0);a.bids.push({seat:0,bid:null,suit:null});
      a.currentBidder=nextAIBidder(a);a.done=auctionDone(a);
      return addLog({...s,auction:a},'You passed');
    });
  },[]);

  const humanSkipAuction=useCallback(()=>{
    setGs(s=>{ if(!s||s.phase!==PHASE.AUCTION)return s; return addLog({...s,phase:PHASE.REVEAL,trump:'S',auctionWinner:null},'Auction skipped — Spades ♠ is trump'); });
  },[]);

  const nextRound=useCallback(()=>{
    setGs(s=>{
      if(!s)return s;
      if(s.roundNum>=totalRounds){
        // Game over — trigger game over screen via phase
        return {...s,phase:'GAME_OVER'};
      }
      const next=initRound(ccwNext(s.dealer),s.scores,s.roundNum+1);
      return {...next,history:s.history||[]};
    });
  },[totalRounds]);

  return {screen,gs,startGame,goMenu,humanPlay,humanAuctionBid,humanAuctionPass,humanSkipAuction,placeBid,nextRound,sortedHand,toggleSort:()=>setSortedHand(v=>!v)};
}

// ═══════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════
export default function App(){
  const [totalRounds,setTotalRounds]=useState(5);
  const {screen,gs,startGame,goMenu,humanPlay,humanAuctionBid,humanAuctionPass,humanSkipAuction,placeBid,nextRound,sortedHand,toggleSort}=useGameStore(totalRounds);

  return (
    <>
      <style>{CSS}</style>
      <div className="cb-root">
        {screen==='menu' ? (
          <MainMenu onStart={startGame} totalRounds={totalRounds} setTotalRounds={setTotalRounds}/>
        ) : gs ? (
          gs.phase==='GAME_OVER' ? (
            <GameOverScreen gs={gs} onRestart={()=>{ goMenu(); }}/>
          ) : (
            <GameTable
              gs={gs}
              totalRounds={totalRounds}
              onCardPlay={humanPlay}
              onAuctionBid={humanAuctionBid}
              onAuctionPass={humanAuctionPass}
              onSkipAuction={humanSkipAuction}
              onBid={placeBid}
              onNext={nextRound}
              onBack={goMenu}
              sortedHand={sortedHand}
              onToggleSort={toggleSort}
            />
          )
        ):null}
      </div>
    </>
  );
}

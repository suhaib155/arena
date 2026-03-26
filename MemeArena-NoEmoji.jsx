import { useState, useEffect, useRef, createContext, useContext } from "react";
import {
  Home, Zap, Plus, Bell, User, Trophy, Search, Star, Flame, Clock,
  Users, Award, Heart, Share2, ArrowLeft, X, Upload, Check, Crown,
  TrendingUp, MessageCircle, ChevronRight, Gift, Eye, ThumbsUp,
  Timer, Sparkles, Medal, Target, Bookmark, Settings, Filter,
  Wallet, LogOut, Copy, ExternalLink, CheckCircle, AlertCircle, Loader,
  Mail, Lock, AtSign, Swords, BarChart2, DollarSign, Shield, Globe,
  Hash, PartyPopper, Play, Shuffle, Image, Type, Mic, Camera,
  LayoutGrid, Layers, ChevronDown, ArrowRight, TrendingDown,
  Activity, Hexagon, Circle, Triangle, Square
} from "lucide-react";

/* ═══════════════════════════════════════════════════
   GLOBAL STYLES
═══════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#ECEAE5;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;}

:root{
  --coral:#E8512A;--coral-lt:#FFF0EB;--coral-dk:#C43E1A;
  --ink:#141420;--slate:#44445A;--muted:#8A8AA0;--ghost:#C0BFCC;
  --pale:#F5F3EF;--cream:#FAFAF8;--white:#FFFFFF;
  --border:#E8E5DF;--border2:#D8D5CF;
  --mint:#00B896;--mint-lt:#E3FAF5;
  --amber:#D97706;--amber-lt:#FEF3C7;
  --violet:#6D5FFA;--violet-lt:#F0EEFF;
  --sky:#3B82F6;--sky-lt:#EFF6FF;
  --danger:#DC2626;--success:#059669;
  --card-sh:0 1px 12px rgba(0,0,0,.06),0 4px 24px rgba(0,0,0,.04);
  --card-sh-lg:0 8px 40px rgba(0,0,0,.12);
  --grad-fire:linear-gradient(135deg,#E8512A,#F97316);
  --grad-ocean:linear-gradient(135deg,#3B82F6,#6D5FFA);
  --grad-forest:linear-gradient(135deg,#00B896,#3B82F6);
  --grad-sunset:linear-gradient(135deg,#E8512A,#D97706);
  --grad-candy:linear-gradient(135deg,#EC4899,#6D5FFA);
  --grad-night:linear-gradient(160deg,#141420,#2A2A50);
}

/* animations */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleIn{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes slideRight{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:translateX(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes pulseRing{0%{box-shadow:0 0 0 0 rgba(232,81,42,.45)}70%{box-shadow:0 0 0 11px rgba(232,81,42,0)}100%{box-shadow:0 0 0 0 rgba(232,81,42,0)}}
@keyframes shimmer{from{background-position:-200% 0}to{background-position:200% 0}}
@keyframes winnerReveal{0%{opacity:0;transform:scale(.7)}60%{transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes countUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes gradMove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes confettiFall{0%{transform:translateY(-10px) rotate(0deg);opacity:1}100%{transform:translateY(130px) rotate(540deg);opacity:0}}
@keyframes bar{from{width:0}to{width:var(--w)}}

.fade-up{animation:fadeUp .38s ease both}
.fade-in{animation:fadeIn .28s ease both}
.scale-in{animation:scaleIn .32s cubic-bezier(.34,1.56,.64,1) both}
.slide-up{animation:slideUp .36s cubic-bezier(.34,1.56,.64,1) both}
.slide-right{animation:slideRight .3s ease both}
.float-anim{animation:float 3.5s ease-in-out infinite}
.spin{animation:spin .9s linear infinite}
.winner-reveal{animation:winnerReveal .55s cubic-bezier(.34,1.56,.64,1) both}

/* base components */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;border:none;cursor:pointer;transition:all .18s ease;letter-spacing:-.01em;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-primary{background:var(--grad-fire);color:#fff;border-radius:14px;box-shadow:0 4px 18px rgba(232,81,42,.32);}
.btn-primary:not(:disabled):hover{transform:translateY(-1px);box-shadow:0 7px 24px rgba(232,81,42,.44);}
.btn-primary:not(:disabled):active{transform:translateY(1px);}
.btn-dark{background:var(--ink);color:#fff;border-radius:14px;}
.btn-dark:not(:disabled):hover{background:#1E1E32;}
.btn-outline{background:var(--white);color:var(--coral);border:2px solid var(--coral);border-radius:14px;}
.btn-outline:hover{background:var(--coral-lt);}
.btn-ghost{background:transparent;color:var(--muted);border-radius:10px;}
.btn-ghost:hover{background:var(--pale);color:var(--ink);}
.btn-pale{background:var(--pale);color:var(--slate);border-radius:14px;}
.btn-pale:hover{background:var(--border);}
.btn-sm{padding:8px 16px;font-size:12px;}
.btn-md{padding:12px 22px;font-size:14px;}
.btn-lg{padding:15px 28px;font-size:15px;}
.btn-full{width:100%;}
.btn-icon{width:38px;height:38px;border-radius:11px;padding:0;flex-shrink:0;}

.card{background:var(--white);border-radius:20px;box-shadow:var(--card-sh);overflow:hidden;transition:transform .18s,box-shadow .18s;}
.card-lift:hover{transform:translateY(-2px);box-shadow:var(--card-sh-lg);}
.card-tap:active{transform:scale(.98);}

.chip{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:99px;font-size:12px;font-weight:700;cursor:pointer;border:none;font-family:'Plus Jakarta Sans',sans-serif;transition:all .15s;white-space:nowrap;}
.chip-on{background:var(--ink);color:var(--white);}
.chip-off{background:var(--white);color:var(--muted);border:1.5px solid var(--border);}
.chip-off:hover{border-color:var(--coral);color:var(--coral);}

.tag{display:inline-flex;align-items:center;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;}
.tag-live{background:#FEE2E2;color:#DC2626;}
.tag-voting{background:#FEF9C3;color:#92400E;}
.tag-done{background:var(--pale);color:var(--muted);}
.tag-soon{background:var(--sky-lt);color:var(--sky);}
.tag-free{background:var(--mint-lt);color:var(--mint);}

.input{width:100%;padding:13px 15px;border-radius:13px;border:2px solid var(--border);font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;outline:none;background:var(--white);transition:border-color .18s,box-shadow .18s;color:var(--ink);}
.input:focus{border-color:var(--coral);box-shadow:0 0 0 3px rgba(232,81,42,.1);}
.input::placeholder{color:var(--ghost);}
textarea.input{resize:none;line-height:1.6;}
.input-wrap{position:relative;}
.input-icon{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--ghost);}
.input-pad{padding-left:42px;}

.scroll-x{display:flex;overflow-x:auto;gap:10px;padding:2px 2px 6px;scrollbar-width:none;}
.scroll-x::-webkit-scrollbar{display:none;}

.divider{height:1px;background:var(--border);margin:14px 0;}

.app-shell{max-width:480px;margin:0 auto;min-height:100dvh;background:var(--pale);position:relative;overflow-x:hidden;}
.screen{min-height:100dvh;padding-bottom:88px;}

.header{position:sticky;top:0;z-index:50;background:rgba(245,243,239,.94);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);padding:14px 20px 12px;border-bottom:1px solid rgba(232,229,223,.5);}

.bot-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(255,255,255,.96);backdrop-filter:blur(18px);border-top:1px solid var(--border);display:flex;justify-content:space-around;align-items:center;padding:8px 8px 20px;z-index:100;box-shadow:0 -3px 20px rgba(0,0,0,.06);}
.nav-btn{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:6px 10px;border-radius:12px;border:none;background:transparent;font-family:'Plus Jakarta Sans',sans-serif;transition:all .15s;}
.nav-btn.on{color:var(--coral);}
.nav-btn.off{color:var(--ghost);}
.nav-lbl{font-size:10px;font-weight:700;letter-spacing:.02em;}
.nav-plus{width:52px;height:52px;border-radius:16px;background:var(--grad-fire);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(232,81,42,.42);transform:translateY(-10px);border:none;cursor:pointer;transition:all .18s;}
.nav-plus:hover{transform:translateY(-12px) scale(1.04);}
.nav-plus:active{transform:translateY(-8px) scale(.96);}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:flex-end;justify-content:center;}
.modal-sheet{width:100%;max-width:480px;background:var(--white);border-radius:26px 26px 0 0;padding:6px 20px 40px;max-height:92dvh;overflow-y:auto;animation:slideUp .34s cubic-bezier(.34,1.56,.64,1);}
.modal-handle{width:36px;height:4px;background:var(--border2);border-radius:99px;margin:0 auto 20px;}

.prog-track{background:var(--border);border-radius:99px;overflow:hidden;}
.prog-fill{height:100%;background:var(--grad-fire);border-radius:99px;transition:width .6s cubic-bezier(.4,0,.2,1);}

.live-dot{display:inline-block;width:7px;height:7px;background:#DC2626;border-radius:50%;animation:pulseRing 2s ease-in-out infinite;}

.ticker-wrap{overflow:hidden;white-space:nowrap;background:var(--ink);}
.ticker-inner{display:inline-flex;animation:ticker 24s linear infinite;}
.ticker-item{padding:0 28px;border-right:1px solid rgba(255,255,255,.15);}

.upload-zone{border:2px dashed var(--border2);border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all .18s;}
.upload-zone:hover,.upload-zone.dragging{border-color:var(--coral);background:var(--coral-lt);}

.vote-pair-card{cursor:pointer;transition:all .24s cubic-bezier(.34,1.56,.64,1);}
.vote-pair-card:hover{transform:scale(1.02);}
.vote-pair-card:active{transform:scale(.97);}

.lb-row{display:flex;align-items:center;gap:13px;padding:13px 15px;background:var(--white);border-radius:16px;margin-bottom:8px;cursor:pointer;transition:transform .15s,box-shadow .15s;}
.lb-row:hover{transform:translateX(3px);box-shadow:var(--card-sh);}

.notif-row{display:flex;gap:13px;padding:14px 15px;border-radius:16px;background:var(--white);margin-bottom:8px;cursor:pointer;transition:transform .15s;}
.notif-row:hover{transform:translateX(3px);}

.xp-bar{height:6px;background:var(--border);border-radius:99px;overflow:hidden;}
.xp-fill{height:100%;background:var(--grad-fire);border-radius:99px;transition:width .8s ease;}

@media(min-width:768px){
  body{background:#E0DDD8;}
  .app-shell{border-radius:32px;margin:24px auto;min-height:calc(100dvh - 48px);box-shadow:0 24px 64px rgba(0,0,0,.18);overflow:hidden;}
  .bot-nav{border-radius:0 0 32px 32px;}
}
@media(min-width:1100px){
  body{background:#D8D5D0;}
  .wide-layout{display:flex;gap:24px;justify-content:center;align-items:flex-start;padding:32px 36px;min-height:100dvh;}
  .sidebar-l,.sidebar-r{display:flex!important;flex-direction:column;gap:10px;}
  .sidebar-l{width:210px;position:sticky;top:32px;}
  .sidebar-r{width:260px;position:sticky;top:32px;}
}
.sidebar-l,.sidebar-r{display:none;}
.snav{display:flex;align-items:center;gap:11px;padding:11px 14px;border-radius:13px;border:none;background:transparent;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:14px;cursor:pointer;transition:all .15s;width:100%;}
.snav.on{background:var(--coral-lt);color:var(--coral);}
.snav.off{color:var(--muted);}
.snav.off:hover{background:var(--pale);color:var(--ink);}

.gradient-text{background:var(--grad-fire);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
`;

/* ═══════════════════════════════════════════════════
   CONTEXT
═══════════════════════════════════════════════════ */
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ═══════════════════════════════════════════════════
   MOCK DATA
═══════════════════════════════════════════════════ */
const BATTLES = [
  {id:1,title:"Monday Meme Massacre",theme:"When your alarm goes off at 6am",type:"Meme Battle",status:"live",prize:"$420",entry:"Free",participants:847,timeLeft:"2h 14m",grad:"var(--grad-fire)",cat:"Memes",hot:true,desc:"Submit your most relatable early morning meme. Community votes on the funniest.",
    entries:[
      {id:1,user:"cryptokid",vote_count:284,content:"POV: You said 'just 5 more minutes' 47 times",img:"https://picsum.photos/seed/meme1/400/300"},
      {id:2,user:"memequeen",vote_count:219,content:"My productivity be like...",img:"https://picsum.photos/seed/meme2/400/300"},
      {id:3,user:"lazydev",vote_count:176,content:"The alarm exists. I choose violence.",img:"https://picsum.photos/seed/meme3/400/300"},
      {id:4,user:"sunrisehater",vote_count:143,content:"Morning people explaining their routine",img:"https://picsum.photos/seed/meme4/400/300"},
    ]},
  {id:2,title:"Fake Ad Challenge",theme:"Invent a product nobody asked for",type:"Caption Battle",status:"voting",prize:"$250",entry:"Free",participants:432,timeLeft:"Voting",grad:"var(--grad-ocean)",cat:"Creative",hot:false,desc:"Create a fake advertisement for a completely useless product.",
    entries:[
      {id:5,user:"adgenius",vote_count:312,content:"Introducing Air, but with a subscription",img:"https://picsum.photos/seed/ad1/400/300"},
      {id:6,user:"funnybone",vote_count:287,content:"Sleep? There's a premium tier for that.",img:"https://picsum.photos/seed/ad2/400/300"},
    ]},
  {id:3,title:"AI Remix Arena",theme:"Remix this sunset with pure chaos energy",type:"AI Remix",status:"live",prize:"$600",entry:"Free",participants:1204,timeLeft:"5h 30m",grad:"var(--grad-forest)",cat:"AI Art",hot:true,desc:"Use any AI tool to remix the provided base image. Most chaotic yet beautiful wins.",
    entries:[
      {id:7,user:"promptking",vote_count:445,content:"Vaporwave beach dimension seven",img:"https://picsum.photos/seed/ai1/400/400"},
      {id:8,user:"glitchqueen",vote_count:398,content:"Sunset but make it unhinged",img:"https://picsum.photos/seed/ai2/400/400"},
    ]},
  {id:4,title:"Best One-Liner",theme:"Roast Web3 in exactly 6 words",type:"One-Liner",status:"live",prize:"$180",entry:"Free",participants:2341,timeLeft:"1h 02m",grad:"var(--grad-candy)",cat:"Roasts",hot:true,desc:"Your funniest Web3 roast in exactly six words.",entries:[]},
  {id:5,title:"Poster Design Duel",theme:"Movie poster for Going to Bed",type:"Design Battle",status:"upcoming",prize:"$800",entry:"Free",participants:0,timeLeft:"Starts in 3h",grad:"var(--grad-sunset)",cat:"Design",hot:false,desc:"Design a dramatic movie poster for the most mundane act: going to bed.",entries:[]},
  {id:6,title:"Caption This",theme:"Office dog walks into a board meeting",type:"Caption Battle",status:"completed",prize:"$140",entry:"Free",participants:567,timeLeft:"Ended",grad:"var(--grad-ocean)",cat:"Captions",hot:false,
    winner:{id:9,user:"dogdad",vote_count:521,content:"I heard there were treats in the Q3 report",prize:"$84",img:"https://picsum.photos/seed/dog1/400/300"},
    entries:[
      {id:9,user:"dogdad",vote_count:521,content:"I heard there were treats in the Q3 report",img:"https://picsum.photos/seed/dog1/400/300"},
      {id:10,user:"officepet",vote_count:489,content:"New VP of Morale reporting for duty",img:"https://picsum.photos/seed/dog2/400/300"},
    ]},
];
const CREATORS = [
  {rank:1,name:"MemeLord",handle:"meme_lord",wins:142,xp:9840,badge:"Legend",color:"var(--coral)"},
  {rank:2,name:"ChaosQueen",handle:"chaosq",wins:118,xp:8720,badge:"Icon",color:"var(--violet)"},
  {rank:3,name:"PixelPunks",handle:"pixlpnk",wins:97,xp:7650,badge:"Breakout",color:"var(--mint)"},
  {rank:4,name:"RoastMaster",handle:"roast_m",wins:84,xp:6430,badge:"Contender",color:"var(--amber)"},
  {rank:5,name:"AIArtist",handle:"ai_z",wins:71,xp:5890,badge:"Contender",color:"var(--sky)"},
];
const ROOMS = [
  {id:1,name:"Chaos Corner",host:"MemeLord",desc:"The wildest meme battles on the internet. No rules, just vibes.",members:1204,battles:28,tags:["Memes","Wild","Daily"],featured:true,color:"var(--coral)"},
  {id:2,name:"The Colosseum",host:"ChaosQueen",desc:"Gladiator-style caption battles. Only the sharpest wit survives.",members:892,battles:19,tags:["Captions","Roasts","Brackets"],featured:true,color:"var(--violet)"},
  {id:3,name:"AI Art Lab",host:"AIArtist",desc:"AI remix challenges, prompt battles, and generative art.",members:744,battles:14,tags:["AI","Art","Remixes"],featured:false,color:"var(--mint)"},
  {id:4,name:"Roast Pit",host:"RoastMaster",desc:"Weekly roast championships. Bring your best burns.",members:631,battles:22,tags:["Roasts","Comedy"],featured:false,color:"var(--amber)"},
  {id:5,name:"Design Dojo",host:"PixelPunks",desc:"Poster battles, thumbnail wars, visual creativity contests.",members:431,battles:11,tags:["Design","Visual"],featured:false,color:"var(--sky)"},
];
const NOTIFS = [
  {id:1,icon:"trophy",msg:"You placed 2nd in Monday Meme Battle",sub:"Claim your $84 USDC reward",time:"2m ago",read:false,action:"claim"},
  {id:2,icon:"vote",msg:"Voting is live in Fake Ad Challenge",sub:"845 voters deciding. Your entry is 3rd.",time:"14m ago",read:false,action:"vote"},
  {id:3,icon:"flame",msg:"Keep your 7-day streak alive",sub:"Submit an entry before midnight",time:"1h ago",read:true},
  {id:4,icon:"battle",msg:"MemeLord started a new battle",sub:"Chaos Corner · $200 prize · Free entry",time:"3h ago",read:true,action:"join"},
  {id:5,icon:"bracket",msg:"You advanced to Round 2",sub:"Caption Challenge bracket · 4 players left",time:"5h ago",read:true},
  {id:6,icon:"follow",msg:"ChaosQueen followed you",sub:"Creator · 6,230 followers",time:"8h ago",read:true},
];

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */
const H = ({children,size=1,style={},...p}) => {
  const fs=[28,22,18,15,13][size-1];
  return <span style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:fs,lineHeight:1.15,display:"block",...style}} {...p}>{children}</span>;
};
const InitialAvatar = ({name="?",size=40,color="var(--coral)"}) => (
  <div style={{width:size,height:size,borderRadius:size*.3,background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.38,fontWeight:800,color:"#fff",fontFamily:"'Syne',sans-serif",flexShrink:0}}>
    {name.charAt(0).toUpperCase()}
  </div>
);
const GradBlock = ({grad,size=44,radius=14,children}) => (
  <div style={{width:size,height:size,borderRadius:radius,background:grad,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{children}</div>
);
const Divider = ({m="14px 0"}) => <div style={{height:1,background:"var(--border)",margin:m}}/>;
const Spacer = ({h=12}) => <div style={{height:h}}/>;
const Spinner = ({size=18,color="#fff"}) => (
  <div className="spin" style={{width:size,height:size,borderRadius:"50%",border:`2px solid ${color}28`,borderTop:`2px solid ${color}`}}/>
);
const XPBar = ({pct}) => <div className="xp-bar"><div className="xp-fill" style={{width:`${Math.min(pct,100)}%`}}/></div>;
const StatusTag = ({status}) => {
  const map = {live:["LIVE","tag-live"],voting:["VOTING","tag-voting"],completed:["ENDED","tag-done"],upcoming:["SOON","tag-soon"]};
  const [l,c] = map[status]||["—","tag-done"];
  return (
    <span className={`tag ${c}`} style={{display:"inline-flex",alignItems:"center",gap:4}}>
      {status==="live" && <span className="live-dot"/>}
      {l}
    </span>
  );
};
const NotifIcon = ({type}) => {
  const m = {trophy:<Trophy size={16}/>,vote:<BarChart2 size={16}/>,flame:<Flame size={16}/>,battle:<Swords size={16}/>,bracket:<Layers size={16}/>,follow:<Users size={16}/>};
  return m[type]||<Bell size={16}/>;
};
const ConfettiPiece = () => {
  const colors=["#E8512A","#D97706","#6D5FFA","#00B896","#3B82F6","#EC4899"];
  return <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
    {Array.from({length:28}).map((_,i)=>(
      <div key={i} style={{position:"absolute",left:`${Math.random()*100}%`,top:`${Math.random()*10-5}%`,
        width:8,height:8,background:colors[i%colors.length],borderRadius:Math.random()>.5?"50%":"2px",
        animation:`confettiFall ${.8+Math.random()*.8}s ease forwards`,animationDelay:`${Math.random()*.8}s`}}/>
    ))}
  </div>;
};

/* ═══════════════════════════════════════════════════
   BATTLE CARD
═══════════════════════════════════════════════════ */
const BattleCard = ({b,onClick,compact}) => {
  const [saved,setSaved]=useState(false);
  if(compact) return (
    <div className="card card-tap" style={{cursor:"pointer",display:"flex",gap:12,padding:"13px 15px",alignItems:"center"}} onClick={onClick}>
      <GradBlock grad={b.grad} size={44}><Swords size={18} color="#fff"/></GradBlock>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:14,color:"var(--ink)",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <StatusTag status={b.status}/>
          <span style={{fontSize:12,color:"var(--muted)"}}>{b.prize}</span>
        </div>
      </div>
      <ChevronRight size={15} color="var(--ghost)"/>
    </div>
  );
  return (
    <div className="card card-lift" style={{cursor:"pointer"}} onClick={onClick}>
      <div style={{background:b.grad,padding:"22px 20px 18px",position:"relative",overflow:"hidden",minHeight:160}}>
        <div style={{position:"absolute",right:-20,top:-16,opacity:.08}}>
          <Swords size={120} color="#fff"/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <StatusTag status={b.status}/>
            {b.entry==="Free"&&<span className="tag tag-free">FREE</span>}
          </div>
          <button className="btn btn-icon" style={{background:"rgba(255,255,255,.22)",color:"#fff",width:32,height:32,borderRadius:9}} onClick={e=>{e.stopPropagation();setSaved(!saved);}}>
            <Bookmark size={14} fill={saved?"white":"none"} color="white"/>
          </button>
        </div>
        <H size={2} style={{color:"#fff",marginBottom:6}}>{b.title}</H>
        <p style={{color:"rgba(255,255,255,.78)",fontSize:13,lineHeight:1.5}}>{b.theme}</p>
      </div>
      <div style={{padding:"14px 16px"}}>
        <div style={{display:"flex",gap:14,marginBottom:12}}>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,fontWeight:700,color:"var(--ink)"}}>
            <Trophy size={13} color="var(--coral)"/>{b.prize}
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"var(--muted)"}}>
            <Users size={13}/>{b.participants.toLocaleString()}
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"var(--muted)"}}>
            <Clock size={13}/>{b.timeLeft}
          </span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-primary btn-sm" style={{flex:1}} onClick={e=>{e.stopPropagation();onClick();}}>
            {b.status==="voting"?"Vote Now":b.status==="completed"?"See Results":"Join Battle"}
            <ArrowRight size={14}/>
          </button>
          <button className="btn btn-ghost btn-icon" style={{width:36,height:36}} onClick={e=>e.stopPropagation()}>
            <Share2 size={14} color="var(--muted)"/>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════════════ */
const OnboardingScreen = () => {
  const {navigate,login}=useApp();
  const [slide,setSlide]=useState(0);
  const [mode,setMode]=useState(null);
  const [email,setEmail]=useState("");
  const [pw,setPw]=useState("");
  const [name,setName]=useState("");
  const [loading,setLoading]=useState(false);
  const slides=[
    {icon:<Swords size={40} color="#fff"/>,grad:"var(--grad-fire)",title:"Enter the Arena",body:"Daily creative battles where the community votes and real prizes are paid on Starknet."},
    {icon:<BarChart2 size={40} color="#fff"/>,grad:"var(--grad-ocean)",title:"Submit. Vote. Win.",body:"The best entry takes the prize pool. No luck — just creativity, timing, and wit."},
    {icon:<DollarSign size={40} color="#fff"/>,grad:"var(--grad-forest)",title:"Creativity Pays",body:"Top entries split real USDC prizes. Climb ranks, collect badges, build your reputation."},
  ];
  const s=slides[slide];
  const doAuth=()=>{setLoading(true);setTimeout(()=>{login({name:name||"Player",email});navigate("home");},1100);};

  if(mode) return (
    <div className="screen fade-in" style={{background:"#fff",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px",minHeight:"100dvh",position:"relative"}}>
      <button className="btn btn-ghost btn-icon" style={{position:"absolute",top:20,left:16}} onClick={()=>setMode(null)}><ArrowLeft size={20}/></button>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:60,height:60,borderRadius:18,background:"var(--grad-fire)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
          <Swords size={28} color="#fff"/>
        </div>
        <H size={2} style={{color:"var(--ink)",marginBottom:6}}>{mode==="signup"?"Create Account":"Welcome back"}</H>
        <p style={{color:"var(--muted)",fontSize:14}}>{mode==="signup"?"Join the arena for free":"Log in to continue"}</p>
      </div>
      {mode==="signup"&&(
        <div className="input-wrap" style={{marginBottom:10}}>
          <AtSign size={15} className="input-icon"/>
          <input className="input input-pad" placeholder="Username" value={name} onChange={e=>setName(e.target.value)}/>
        </div>
      )}
      <div className="input-wrap" style={{marginBottom:10}}>
        <Mail size={15} className="input-icon"/>
        <input className="input input-pad" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/>
      </div>
      <div className="input-wrap" style={{marginBottom:20}}>
        <Lock size={15} className="input-icon"/>
        <input className="input input-pad" placeholder="Password" type="password" value={pw} onChange={e=>setPw(e.target.value)}/>
      </div>
      <button className="btn btn-primary btn-lg btn-full" onClick={doAuth} disabled={loading||!email||!pw}>
        {loading?<Spinner/>:mode==="signup"?"Create Account":"Log In"}
      </button>
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"18px 0"}}>
        <div style={{flex:1,height:1,background:"var(--border)"}}/>
        <span style={{fontSize:12,color:"var(--muted)"}}>or</span>
        <div style={{flex:1,height:1,background:"var(--border)"}}/>
      </div>
      {[{icon:<Globe size={16}/>,l:"Continue with Google"},{icon:<Wallet size={16}/>,l:"Connect Wallet"}].map(o=>(
        <button key={o.l} className="btn btn-md btn-full" style={{background:"var(--pale)",color:"var(--ink)",borderRadius:14,marginBottom:10,justifyContent:"flex-start",paddingLeft:18}} onClick={doAuth}>
          {o.icon}{o.l}
        </button>
      ))}
      <p style={{textAlign:"center",marginTop:14,fontSize:13,color:"var(--muted)"}}>
        {mode==="signup"?"Already have an account? ":"New here? "}
        <button className="btn btn-ghost" style={{color:"var(--coral)",padding:"0 4px",fontSize:13}} onClick={()=>setMode(mode==="signup"?"login":"signup")}>
          {mode==="signup"?"Log in":"Sign up"}
        </button>
      </p>
    </div>
  );

  return (
    <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",background:"#fff",overflow:"hidden"}}>
      <div style={{flex:1,overflow:"hidden"}}>
        <div style={{display:"flex",transition:"transform .38s cubic-bezier(.4,0,.2,1)",transform:`translateX(-${slide*100}%)`}}>
          {slides.map((sl,i)=>(
            <div key={i} style={{flex:"none",width:"100vw",maxWidth:480,minHeight:"calc(100dvh - 200px)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 36px",textAlign:"center"}}>
              <div className={`float-anim`} style={{width:120,height:120,borderRadius:36,background:sl.grad,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:36,boxShadow:"0 16px 48px rgba(0,0,0,.18)"}}>
                {sl.icon}
              </div>
              <H size={1} style={{color:"var(--ink)",marginBottom:14}}>{sl.title}</H>
              <p style={{color:"var(--muted)",fontSize:16,lineHeight:1.7,maxWidth:300}}>{sl.body}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={{padding:"0 28px 48px",background:"#fff"}}>
        <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:24}}>
          {slides.map((_,i)=>(
            <div key={i} onClick={()=>setSlide(i)} style={{height:7,borderRadius:99,cursor:"pointer",transition:"all .28s",width:i===slide?26:7,background:i===slide?"var(--coral)":"var(--border)"}}/>
          ))}
        </div>
        {slide<slides.length-1?(
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-pale btn-md" style={{flex:.35,borderRadius:14}} onClick={()=>setSlide(2)}>Skip</button>
            <button className="btn btn-primary btn-md" style={{flex:.65,borderRadius:14}} onClick={()=>setSlide(s=>s+1)}>Next <ArrowRight size={15}/></button>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button className="btn btn-primary btn-lg btn-full" onClick={()=>setMode("signup")}>Create Free Account</button>
            <button className="btn btn-pale btn-md btn-full" onClick={()=>setMode("login")}>I have an account</button>
            <button className="btn btn-ghost btn-sm btn-full" style={{color:"var(--muted)"}} onClick={()=>navigate("home")}>Browse without signing up</button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   HOME SCREEN
═══════════════════════════════════════════════════ */
const HomeScreen = () => {
  const {navigate,notifCount}=useApp();
  const [filter,setFilter]=useState("All");
  const filters=["All","Hot","Free","AI Art","Memes","Roasts","Design"];
  const live=BATTLES[0];
  const filtered=filter==="All"?BATTLES:BATTLES.filter(b=>{
    if(filter==="Hot") return b.hot;
    if(filter==="Free") return b.entry==="Free";
    return b.cat===filter;
  });
  return (
    <div className="screen">
      <div className="header">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <H size={2} style={{color:"var(--ink)",letterSpacing:"-.02em",lineHeight:1}}>
              Meme<span className="gradient-text">Arena</span>
            </H>
            <p style={{color:"var(--muted)",fontSize:12,marginTop:2}}>Arena is live — 8 active battles</p>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-ghost btn-icon" style={{position:"relative"}} onClick={()=>navigate("notifications")}>
              <Bell size={20} color="var(--ink)"/>
              {notifCount>0&&<span style={{position:"absolute",top:7,right:7,width:8,height:8,background:"var(--coral)",borderRadius:"50%",border:"2px solid var(--pale)"}}/>}
            </button>
            <button className="btn btn-icon" style={{background:"transparent",padding:0}} onClick={()=>navigate("profile")}>
              <InitialAvatar name="F" size={36} color="var(--coral)"/>
            </button>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="ticker-wrap" style={{padding:"7px 0"}}>
        <div className="ticker-inner">
          {[...Array(2)].map((_,r)=>(
            <span key={r} style={{display:"inline-flex"}}>
              {BATTLES.filter(b=>b.status==="live").map(b=>(
                <span key={b.id} className="ticker-item" style={{color:"rgba(255,255,255,.7)",fontSize:11,fontWeight:600,padding:"0 22px"}}>
                  <span style={{color:"#fff",fontWeight:700}}>{b.title}</span> &nbsp;·&nbsp; {b.prize} &nbsp;·&nbsp; {b.participants} in
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div style={{padding:"14px 20px 0"}}>
        {/* Hero Card */}
        <div className="card fade-up" style={{cursor:"pointer",background:live.grad,overflow:"visible",marginBottom:12}} onClick={()=>navigate("battle",live)}>
          <div style={{padding:"22px 20px 18px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",right:-24,top:-20,opacity:.07}}><Swords size={130} color="#fff"/></div>
            <div style={{display:"flex",gap:7,marginBottom:12}}>
              <StatusTag status="live"/>
              <span className="tag" style={{background:"rgba(255,255,255,.22)",color:"#fff"}}>
                <Trophy size={10} style={{marginRight:4}}/>{live.prize}
              </span>
            </div>
            <H size={1} style={{color:"#fff",marginBottom:7}}>{live.title}</H>
            <p style={{color:"rgba(255,255,255,.8)",fontSize:13,marginBottom:18}}>{live.participants.toLocaleString()} creators competing now</p>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-md" style={{flex:1,background:"rgba(255,255,255,.95)",color:"var(--coral)",fontWeight:800,borderRadius:13,fontSize:14}}>
                Join Battle <Swords size={14}/>
              </button>
              <button className="btn" style={{background:"rgba(255,255,255,.2)",color:"#fff",borderRadius:13,padding:"12px 14px"}}>
                <Eye size={17}/>
              </button>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
          {[{l:"Active",v:"12",I:Swords},{l:"Prize Pool",v:"$4.2K",I:DollarSign},{l:"Online",v:"8.4K",I:Users}].map((s,i)=>(
            <div key={i} className="card fade-up" style={{padding:"13px 10px",textAlign:"center",animationDelay:`${i*.06}s`}}>
              <s.I size={16} color="var(--coral)" style={{margin:"0 auto 6px"}}/>
              <H size={3} style={{color:"var(--ink)"}}>{s.v}</H>
              <p style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{s.l}</p>
            </div>
          ))}
        </div>

        {/* Filter Chips */}
        <div className="scroll-x" style={{marginBottom:12}}>
          {filters.map(f=>(
            <button key={f} className={`chip ${filter===f?"chip-on":"chip-off"}`} onClick={()=>setFilter(f)}>{f}</button>
          ))}
        </div>

        {/* Battle Cards */}
        {filtered.map((b,i)=>(
          <div key={b.id} style={{marginBottom:12}}>
            <BattleCard b={b} onClick={()=>navigate(b.status==="voting"?"voting":b.status==="completed"?"winner":"battle",b)}/>
          </div>
        ))}

        {/* Top Creators */}
        <div style={{margin:"4px 0 0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <H size={3} style={{color:"var(--ink)"}}>Top Creators</H>
            <button className="btn btn-ghost btn-sm" style={{color:"var(--coral)"}} onClick={()=>navigate("leaderboard")}>See all</button>
          </div>
          <div className="scroll-x">
            {CREATORS.map((c,i)=>(
              <div key={c.rank} className="card card-lift fade-up" style={{minWidth:120,padding:"14px 12px",textAlign:"center",cursor:"pointer",animationDelay:`${i*.05}s`}} onClick={()=>navigate("profile")}>
                <InitialAvatar name={c.name} size={44} color={c.color}/>
                <div style={{fontWeight:700,fontSize:13,color:"var(--ink)",marginTop:8,whiteSpace:"nowrap"}}>{c.name}</div>
                <div style={{fontSize:11,color:"var(--muted)",margin:"2px 0 6px"}}>{c.wins} wins</div>
                <span style={{fontSize:11,fontWeight:700,color:c.color,background:`${c.color}18`,padding:"3px 9px",borderRadius:99}}>{c.badge}</span>
              </div>
            ))}
          </div>
        </div>
        <Spacer h={8}/>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   BATTLE DETAIL
═══════════════════════════════════════════════════ */
const BattleDetailScreen = ({battle}) => {
  const {navigate,setShowCreate}=useApp();
  const b=battle||BATTLES[0];
  const [tab,setTab]=useState("entries");
  const [joined,setJoined]=useState(false);
  return (
    <div className="screen">
      <div style={{background:b.grad,padding:"52px 20px 24px",position:"relative"}}>
        <button className="btn btn-icon" style={{position:"absolute",top:14,left:14,background:"rgba(255,255,255,.22)",color:"#fff"}} onClick={()=>navigate("home")}><ArrowLeft size={20}/></button>
        <button className="btn btn-icon" style={{position:"absolute",top:14,right:14,background:"rgba(255,255,255,.22)",color:"#fff"}}><Share2 size={17}/></button>
        <div style={{display:"flex",gap:7,marginBottom:12}}>
          <StatusTag status={b.status}/>
          <span className="tag" style={{background:"rgba(255,255,255,.22)",color:"#fff"}}>{b.type}</span>
          {b.entry==="Free"&&<span className="tag tag-free">FREE</span>}
        </div>
        <H size={1} style={{color:"#fff",marginBottom:8}}>{b.title}</H>
        <p style={{color:"rgba(255,255,255,.8)",fontSize:14,lineHeight:1.5}}>{b.theme}</p>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{background:"#fff",borderRadius:"0 0 22px 22px",padding:"14px",boxShadow:"0 4px 18px rgba(0,0,0,.06)",marginBottom:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,textAlign:"center"}}>
            {[{l:"Prize",v:b.prize,I:Trophy,c:"var(--coral)"},{l:"Players",v:b.participants.toLocaleString(),I:Users,c:"var(--violet)"},{l:"Time Left",v:b.timeLeft,I:Clock,c:"var(--mint)"}].map((s,i)=>(
              <div key={i}><s.I size={14} color={s.c} style={{margin:"0 auto 4px"}}/><H size={3} style={{color:"var(--ink)"}}>{s.v}</H><p style={{fontSize:11,color:"var(--muted)"}}>{s.l}</p></div>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:4,background:"var(--pale)",borderRadius:13,padding:4,marginBottom:14}}>
          {["entries","rules","leaderboard"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all .15s",background:tab===t?"#fff":"transparent",color:tab===t?"var(--ink)":"var(--muted)",boxShadow:tab===t?"0 2px 8px rgba(0,0,0,.06)":"none",textTransform:"capitalize"}}>{t}</button>
          ))}
        </div>
        {tab==="entries"&&(
          b.entries.length>0?(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {b.entries.map((e,i)=>(
                <div key={e.id} className="card card-tap fade-up" style={{cursor:"pointer",animationDelay:`${i*.05}s`}}>
                  <img src={e.img} alt="" style={{width:"100%",aspectRatio:"4/3",objectFit:"cover"}}/>
                  <div style={{padding:"10px"}}>
                    <p style={{fontSize:12,fontWeight:600,color:"var(--ink)",marginBottom:5,lineHeight:1.4}}>{e.content}</p>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:11,color:"var(--muted)"}}>@{e.user}</span>
                      <span style={{display:"flex",alignItems:"center",gap:3,fontSize:12,color:"var(--coral)",fontWeight:700}}>
                        <Heart size={11} fill="var(--coral)" color="var(--coral)"/>{e.vote_count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ):(
            <div style={{textAlign:"center",padding:"48px 0"}}>
              <Star size={44} color="var(--border)" style={{margin:"0 auto 12px"}}/>
              <H size={3} style={{color:"var(--ink)",marginBottom:6}}>Be first in</H>
              <p style={{color:"var(--muted)",fontSize:14}}>No entries yet. Claim your spot.</p>
            </div>
          )
        )}
        {tab==="rules"&&(
          <div>
            {[{I:Target,c:"var(--coral)",t:"Challenge",b:`Match the theme: "${b.theme}"`},{I:Upload,c:"var(--violet)",t:"Submission",b:"Upload image, GIF, or text. One entry per user."},{I:BarChart2,c:"var(--mint)",t:"Voting",b:"Community votes in rounds. Most votes wins."},{I:Trophy,c:"var(--amber)",t:"Prizes",b:`Top 3 entries split the ${b.prize} prize pool in USDC.`},{I:Shield,c:"var(--sky)",t:"Rules",b:"Original content only. Keep it fun and respectful."}].map((r,i)=>(
              <div key={i} className="card fade-up" style={{padding:"15px",marginBottom:9,animationDelay:`${i*.05}s`}}>
                <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                  <div style={{width:36,height:36,borderRadius:11,background:`${r.c}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><r.I size={17} color={r.c}/></div>
                  <div><p style={{fontWeight:700,color:"var(--ink)",marginBottom:3,fontSize:14}}>{r.t}</p><p style={{fontSize:13,color:"var(--muted)",lineHeight:1.55}}>{r.b}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab==="leaderboard"&&(
          <div>
            {[...b.entries].sort((a,z)=>z.vote_count-a.vote_count).map((e,i)=>(
              <div key={e.id} className="lb-row fade-up" style={{animationDelay:`${i*.05}s`}}>
                <div style={{width:32,height:32,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,background:i===0?"#FEF9C3":i===1?"#F3F4F6":i===2?"#FEF3C7":"var(--pale)",color:i<3?"var(--ink)":"var(--muted)",flexShrink:0}}>{i+1}</div>
                <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>@{e.user}</p><p style={{fontSize:12,color:"var(--muted)",marginTop:1}}>{e.content}</p></div>
                <div style={{textAlign:"right"}}><H size={3} style={{color:"var(--coral)"}}>{e.vote_count}</H><p style={{fontSize:11,color:"var(--muted)"}}>votes</p></div>
              </div>
            ))}
            {b.entries.length===0&&<p style={{textAlign:"center",padding:"40px 0",color:"var(--muted)"}}>No entries yet</p>}
          </div>
        )}
      </div>
      <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,padding:"0 20px",zIndex:90}}>
        <button className="btn btn-primary btn-lg btn-full" style={{boxShadow:"0 8px 28px rgba(232,81,42,.38)"}} onClick={()=>{setJoined(true);setShowCreate(true);}}>
          {joined?"In the Arena":b.status==="voting"?"Vote Now":b.status==="completed"?"View Results":"Join Battle"}
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   VOTING SCREEN
═══════════════════════════════════════════════════ */
const VotingScreen = ({battle}) => {
  const {navigate}=useApp();
  const b=battle||BATTLES[1];
  const [pairIdx,setPairIdx]=useState(0);
  const [voted,setVoted]=useState(null);
  const [xp,setXp]=useState(0);
  const [done,setDone]=useState(false);
  const pairs=[];
  for(let i=0;i<b.entries.length-1;i+=2) pairs.push([b.entries[i],b.entries[i+1]]);
  if(!pairs.length) return <div style={{padding:40,textAlign:"center",color:"var(--muted)"}}>No entries to vote on yet.</div>;
  const pair=pairs[pairIdx%pairs.length];

  const doVote=(id)=>{
    if(voted) return;
    setVoted(id);setXp(p=>p+50);
    setTimeout(()=>{if(pairIdx+1>=pairs.length){setDone(true);}else{setPairIdx(p=>p+1);setVoted(null);}},700);
  };

  if(done) return (
    <div style={{position:"fixed",inset:0,zIndex:300,background:"var(--grad-fire)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px"}}>
      <ConfettiPiece/>
      <div style={{textAlign:"center",position:"relative",zIndex:1}}>
        <div className="float-anim" style={{width:88,height:88,borderRadius:28,background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}><CheckCircle size={44} color="#fff"/></div>
        <H size={1} style={{color:"#fff",marginBottom:8}}>Votes Cast</H>
        <p style={{color:"rgba(255,255,255,.82)",fontSize:15,marginBottom:28,lineHeight:1.6}}>You voted in {pairs.length} round{pairs.length!==1?"s":""} and earned</p>
        <div style={{background:"rgba(255,255,255,.18)",borderRadius:20,padding:"16px 28px",marginBottom:24}}>
          <H size={1} style={{color:"#fff"}}>+{xp} XP</H>
          <p style={{color:"rgba(255,255,255,.7)",fontSize:13,marginTop:4}}>Results drop when battle ends</p>
        </div>
        <button className="btn btn-lg btn-full" style={{background:"rgba(255,255,255,.95)",color:"var(--coral)",borderRadius:16,fontWeight:800}} onClick={()=>navigate("home")}>Back to Arena</button>
      </div>
    </div>
  );

  return (
    <div className="screen" style={{background:"var(--ink)",paddingBottom:0}}>
      <div style={{padding:"48px 20px 20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <button className="btn btn-icon" style={{background:"rgba(255,255,255,.12)",color:"#fff"}} onClick={()=>navigate("home")}><ArrowLeft size={20}/></button>
          <span style={{color:"rgba(255,255,255,.5)",fontSize:13}}>Round {pairIdx+1} / {pairs.length}</span>
          <span style={{background:"rgba(255,255,255,.12)",borderRadius:10,padding:"6px 12px",color:"#D97706",fontWeight:700,fontSize:13}}>+{xp} XP</span>
        </div>
        <div style={{marginBottom:16}}>
          <H size={3} style={{color:"#fff",marginBottom:7}}>{b.title}</H>
          <div style={{background:"rgba(255,255,255,.12)",borderRadius:99,height:4}}>
            <div style={{width:`${(pairIdx/pairs.length)*100}%`,background:"var(--grad-fire)",height:"100%",borderRadius:99,transition:"width .4s ease"}}/>
          </div>
        </div>
        <p style={{color:"rgba(255,255,255,.55)",fontSize:13,marginBottom:20,textAlign:"center"}}>Tap the entry you think is better</p>
        <div style={{position:"relative"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {pair.map(entry=>(
              <div key={entry.id} className="vote-pair-card" onClick={()=>doVote(entry.id)} style={{
                borderRadius:20,overflow:"hidden",
                border:`2.5px solid ${voted===entry.id?"var(--amber)":voted&&voted!==entry.id?"rgba(255,255,255,.04)":"rgba(255,255,255,.12)"}`,
                opacity:voted&&voted!==entry.id?.4:1,
                transform:voted===entry.id?"scale(1.04)":"scale(1)",
                transition:"all .28s cubic-bezier(.34,1.56,.64,1)"}}>
                <img src={entry.img} alt="" style={{width:"100%",aspectRatio:"1",objectFit:"cover",display:"block"}}/>
                <div style={{background:voted===entry.id?"rgba(217,119,6,.92)":"rgba(14,14,30,.9)",padding:"10px",backdropFilter:"blur(6px)"}}>
                  {voted===entry.id&&<Check size={14} color="white" style={{margin:"0 auto 3px",display:"block"}}/>}
                  <p style={{fontSize:12,fontWeight:700,color:"#fff",lineHeight:1.3}}>{entry.content}</p>
                  <p style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2}}>@{entry.user}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{position:"absolute",top:"40%",left:"50%",transform:"translate(-50%,-50%)",zIndex:10,background:"var(--grad-fire)",color:"#fff",fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:13,width:40,height:40,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(232,81,42,.5)"}}>VS</div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   WINNER SCREEN
═══════════════════════════════════════════════════ */
const WinnerScreen = ({battle}) => {
  const {navigate}=useApp();
  const b=battle||BATTLES[5];
  const w=b.winner||b.entries?.[0];
  const runners=b.entries?.filter(e=>e.id!==w?.id).slice(0,2)||[];
  return (
    <div className="screen">
      <div style={{height:4,display:"flex"}}>
        {Array.from({length:36}).map((_,i)=>(
          <div key={i} style={{flex:1,background:["var(--coral)","var(--amber)","var(--violet)","var(--mint)"][i%4]}}/>
        ))}
      </div>
      <div style={{padding:"18px 20px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
          <button className="btn btn-ghost btn-icon" onClick={()=>navigate("home")}><ArrowLeft size={20}/></button>
          <H size={3} style={{color:"var(--ink)"}}>Battle Results</H>
        </div>
        <div className="card fade-in" style={{padding:"13px 15px",marginBottom:16,display:"flex",gap:12,alignItems:"center"}}>
          <GradBlock grad={b.grad} size={46}><Swords size={20} color="#fff"/></GradBlock>
          <div><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{b.title}</p><p style={{fontSize:12,color:"var(--muted)"}}>{b.participants} participants · {b.prize} total prize</p></div>
        </div>
        {w&&(
          <div className="winner-reveal" style={{marginBottom:18}}>
            <div style={{borderRadius:24,overflow:"hidden",background:"linear-gradient(135deg,#B45309,#D97706,#F59E0B)",position:"relative",boxShadow:"0 10px 40px rgba(217,119,6,.3)"}}>
              <ConfettiPiece/>
              <div style={{padding:"22px 18px",textAlign:"center",position:"relative",zIndex:1}}>
                <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.2)",borderRadius:99,padding:"5px 14px",marginBottom:12}}>
                  <Crown size={13} color="#fff"/><span style={{color:"#fff",fontSize:11,fontWeight:700,letterSpacing:".08em"}}>WINNER</span>
                </div>
                <img src={w.img} alt="" style={{width:"100%",maxWidth:280,aspectRatio:"4/3",objectFit:"cover",borderRadius:16,marginBottom:14,boxShadow:"0 8px 32px rgba(0,0,0,.22)",display:"block",margin:"0 auto 14px"}}/>
                <p style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,color:"#fff",marginBottom:5}}>{w.content}</p>
                <p style={{color:"rgba(255,255,255,.75)",fontSize:13,marginBottom:14}}>by @{w.user} · {w.vote_count} votes</p>
                <div style={{display:"inline-flex",alignItems:"center",gap:7,background:"rgba(255,255,255,.18)",borderRadius:14,padding:"10px 20px",marginBottom:16}}>
                  <DollarSign size={16} color="#fff"/><H size={3} style={{color:"#fff"}}>{w.prize}</H>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn btn-md" style={{flex:1,background:"rgba(255,255,255,.94)",color:"var(--amber)",fontWeight:800,borderRadius:13}} onClick={()=>navigate("wallet")}>Claim Prize</button>
                  <button className="btn btn-md" style={{flex:1,background:"rgba(255,255,255,.2)",color:"#fff",borderRadius:13}}><Share2 size={15}/>Share</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {runners.length>0&&(
          <div style={{marginBottom:14}}>
            <H size={4} style={{color:"var(--ink)",marginBottom:10}}>Runner Ups</H>
            {runners.map((e,i)=>(
              <div key={e.id} className="card fade-up" style={{padding:"13px 15px",marginBottom:8,display:"flex",gap:12,alignItems:"center",animationDelay:`${i*.08}s`}}>
                <div style={{width:32,height:32,borderRadius:10,background:i===0?"#F3F4F6":"#FEF3C7",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Medal size={16} color={i===0?"var(--slate)":"var(--amber)"}/>
                </div>
                <img src={e.img} alt="" style={{width:52,height:42,objectFit:"cover",borderRadius:10,flexShrink:0}}/>
                <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)",fontSize:13}}>{e.content}</p><p style={{fontSize:11,color:"var(--muted)"}}>@{e.user} · {e.vote_count} votes</p></div>
              </div>
            ))}
          </div>
        )}
        <div className="card" style={{padding:"17px",background:"var(--grad-fire)"}}>
          <H size={4} style={{color:"#fff",marginBottom:5}}>Ready for the next round?</H>
          <p style={{color:"rgba(255,255,255,.78)",fontSize:13,marginBottom:12}}>3 live battles waiting for you right now</p>
          <button className="btn btn-md btn-full" style={{background:"rgba(255,255,255,.94)",color:"var(--coral)",fontWeight:800,borderRadius:13}} onClick={()=>navigate("home")}>Back to Arena <ArrowRight size={14}/></button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   ROOMS SCREEN
═══════════════════════════════════════════════════ */
const RoomsScreen = () => {
  const {navigate}=useApp();
  const [tab,setTab]=useState("discover");
  return (
    <div className="screen">
      <div className="header">
        <H size={2} style={{color:"var(--ink)",marginBottom:12}}>Rooms</H>
        <div style={{display:"flex",gap:4,background:"var(--pale)",borderRadius:13,padding:4}}>
          {[{k:"discover",l:"Discover"},{k:"joined",l:"My Rooms"},{k:"create",l:"Create"}].map(t=>(
            <button key={t.k} onClick={()=>t.k==="create"?navigate("create-room"):setTab(t.k)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all .15s",background:tab===t.k&&t.k!=="create"?"#fff":"transparent",color:tab===t.k&&t.k!=="create"?"var(--ink)":t.k==="create"?"var(--coral)":"var(--muted)",boxShadow:tab===t.k&&t.k!=="create"?"0 2px 8px rgba(0,0,0,.06)":"none"}}>{t.l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"12px 20px"}}>
        <H size={4} style={{color:"var(--ink)",marginBottom:10}}>Featured</H>
        <div className="scroll-x" style={{marginBottom:18}}>
          {ROOMS.filter(r=>r.featured).map(r=>(
            <div key={r.id} className="card card-lift" style={{minWidth:230,padding:"18px",cursor:"pointer",flexShrink:0}} onClick={()=>navigate("room-detail",r)}>
              <div style={{width:44,height:44,borderRadius:14,background:r.color,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}><Layers size={20} color="#fff"/></div>
              <H size={4} style={{color:"var(--ink)",marginBottom:4}}>{r.name}</H>
              <p style={{fontSize:12,color:"var(--muted)",marginBottom:12,lineHeight:1.5}}>{r.desc}</p>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {r.tags.map(t=><span key={t} style={{fontSize:11,fontWeight:700,color:r.color,background:`${r.color}15`,padding:"3px 9px",borderRadius:99}}>{t}</span>)}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--muted)"}}>
                <span style={{display:"flex",alignItems:"center",gap:4}}><Users size={11}/>{r.members.toLocaleString()}</span>
                <span style={{display:"flex",alignItems:"center",gap:4}}><Swords size={11}/>{r.battles} battles</span>
              </div>
            </div>
          ))}
        </div>
        <H size={4} style={{color:"var(--ink)",marginBottom:10}}>All Rooms</H>
        {ROOMS.map((r,i)=>(
          <div key={r.id} className="card card-lift card-tap fade-up" style={{padding:"15px",marginBottom:10,cursor:"pointer",animationDelay:`${i*.05}s`}} onClick={()=>navigate("room-detail",r)}>
            <div style={{display:"flex",gap:13,alignItems:"center"}}>
              <div style={{width:50,height:50,borderRadius:16,background:r.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Layers size={22} color="#fff"/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2}}>
                  <p style={{fontWeight:700,fontSize:15,color:"var(--ink)"}}>{r.name}</p>
                  {r.featured&&<span style={{fontSize:10,fontWeight:700,color:"var(--amber)",background:"var(--amber-lt)",padding:"2px 7px",borderRadius:99}}>TOP</span>}
                </div>
                <p style={{fontSize:12,color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5}}>{r.desc}</p>
                <div style={{display:"flex",gap:10}}>
                  <span style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:3}}><Users size={10}/>{r.members.toLocaleString()}</span>
                  <span style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:3}}><Swords size={10}/>{r.battles}</span>
                </div>
              </div>
              <InitialAvatar name={r.host} size={30} color={r.color}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   ROOM DETAIL
═══════════════════════════════════════════════════ */
const RoomDetailScreen = ({room}) => {
  const {navigate}=useApp();
  const r=room||ROOMS[0];
  const [following,setFollowing]=useState(false);
  return (
    <div className="screen">
      <div style={{background:r.color,padding:"52px 20px 26px",position:"relative"}}>
        <button className="btn btn-icon" style={{position:"absolute",top:14,left:14,background:"rgba(255,255,255,.22)",color:"#fff"}} onClick={()=>navigate("rooms")}><ArrowLeft size={20}/></button>
        <button className="btn btn-icon" style={{position:"absolute",top:14,right:14,background:"rgba(255,255,255,.22)",color:"#fff"}}><Share2 size={17}/></button>
        <div style={{width:56,height:56,borderRadius:18,background:"rgba(255,255,255,.22)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}><Layers size={26} color="#fff"/></div>
        <H size={2} style={{color:"#fff",marginBottom:6}}>{r.name}</H>
        <p style={{color:"rgba(255,255,255,.8)",fontSize:14,lineHeight:1.5,marginBottom:14}}>{r.desc}</p>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {r.tags.map(t=><span key={t} style={{background:"rgba(255,255,255,.22)",color:"#fff",fontSize:11,padding:"4px 11px",borderRadius:99,fontWeight:700}}>{t}</span>)}
        </div>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{background:"#fff",borderRadius:"0 0 22px 22px",padding:"15px",boxShadow:"0 4px 18px rgba(0,0,0,.06)",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:13}}>
            <InitialAvatar name={r.host} size={42} color={r.color}/>
            <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)"}}>Hosted by {r.host}</p><p style={{fontSize:12,color:"var(--muted)"}}>{r.battles} battles hosted</p></div>
            <button className="btn btn-sm" style={{background:following?"var(--pale)":"var(--ink)",color:following?"var(--muted)":"#fff",borderRadius:11,padding:"7px 14px"}} onClick={()=>setFollowing(!following)}>
              {following?"Following":"+ Follow"}
            </button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,textAlign:"center"}}>
            {[{l:"Members",v:r.members.toLocaleString()},{l:"Battles",v:r.battles},{l:"Prize Pool",v:"$2.1K"}].map((s,i)=>(
              <div key={i}><H size={3} style={{color:"var(--ink)"}}>{s.v}</H><p style={{fontSize:11,color:"var(--muted)"}}>{s.l}</p></div>
            ))}
          </div>
        </div>
        <H size={4} style={{color:"var(--ink)",marginBottom:10}}>Active Battles</H>
        {BATTLES.filter(b=>b.status==="live").slice(0,3).map((b,i)=>(
          <div key={b.id} style={{marginBottom:8}}><BattleCard b={b} compact onClick={()=>navigate("battle",b)}/></div>
        ))}
        <Spacer h={8}/>
        <H size={4} style={{color:"var(--ink)",marginBottom:10}}>Top Contributors</H>
        {CREATORS.slice(0,4).map((c,i)=>(
          <div key={c.rank} className="lb-row fade-up" style={{animationDelay:`${i*.05}s`}}>
            <div style={{width:26,height:26,borderRadius:8,background:i<3?"var(--amber-lt)":"var(--pale)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i<3?<Trophy size={13} color="var(--amber)"/>:<span style={{fontSize:12,fontWeight:700,color:"var(--muted)"}}>{i+1}</span>}</div>
            <InitialAvatar name={c.name} size={36} color={c.color}/>
            <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{c.name}</p><p style={{fontSize:11,color:"var(--muted)"}}>{c.wins} wins</p></div>
            <span style={{fontSize:11,fontWeight:700,color:c.color,background:`${c.color}18`,padding:"3px 9px",borderRadius:99}}>{c.badge}</span>
          </div>
        ))}
        <Spacer h={16}/>
        <button className="btn btn-primary btn-lg btn-full">Join This Room</button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   CREATE ROOM
═══════════════════════════════════════════════════ */
const CreateRoomScreen = () => {
  const {navigate}=useApp();
  const [step,setStep]=useState(1);
  const [form,setForm]=useState({name:"",desc:"",theme:"",prizeType:"free",prizeAmt:"",tags:[],color:"var(--coral)"});
  const [loading,setLoading]=useState(false);
  const colors=["var(--coral)","var(--violet)","var(--mint)","var(--amber)","var(--sky)","#EC4899"];
  const tagOpts=["Memes","Captions","Roasts","AI Art","Design","One-Liners","Speed","Brackets"];
  const launch=()=>{setLoading(true);setTimeout(()=>navigate("rooms"),1200);};
  return (
    <div className="screen">
      <div className="header">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button className="btn btn-ghost btn-icon" onClick={()=>navigate("rooms")}><ArrowLeft size={20}/></button>
          <H size={3} style={{color:"var(--ink)"}}>Create a Room</H>
        </div>
        <div style={{display:"flex",gap:5,marginTop:12}}>
          {[1,2,3].map(s=><div key={s} style={{flex:1,height:3,borderRadius:99,background:s<=step?"var(--coral)":"var(--border)",transition:"background .3s"}}/>)}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
          {["Room Info","Battle Setup","Launch"].map((l,i)=><span key={i} style={{fontSize:11,fontWeight:600,color:i+1<=step?"var(--coral)":"var(--muted)"}}>{l}</span>)}
        </div>
      </div>
      <div style={{padding:"12px 20px"}}>
        {step===1&&(
          <div className="fade-up">
            <div style={{marginBottom:14}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:7,letterSpacing:".05em"}}>ROOM NAME</p>
              <input className="input" placeholder="e.g. The Colosseum, Chaos Corner..." value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}/>
            </div>
            <div style={{marginBottom:14}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:7}}>DESCRIPTION</p>
              <textarea className="input" rows={3} placeholder="Tell people what your room is about..." value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))}/>
            </div>
            <div style={{marginBottom:18}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9}}>ROOM COLOR</p>
              <div style={{display:"flex",gap:9}}>
                {colors.map(c=>(
                  <div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:40,height:40,borderRadius:12,background:c,cursor:"pointer",border:form.color===c?"3px solid var(--ink)":"3px solid transparent",transition:"all .15s"}}/>
                ))}
              </div>
            </div>
            <div style={{marginBottom:18}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9}}>TAGS (pick up to 3)</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                {tagOpts.map(t=>(
                  <button key={t} className={`chip ${form.tags.includes(t)?"chip-on":"chip-off"}`} onClick={()=>setForm(p=>({...p,tags:p.tags.includes(t)?p.tags.filter(x=>x!==t):p.tags.length<3?[...p.tags,t]:p.tags}))}>{t}</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:18}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9}}>PREVIEW</p>
              <div style={{borderRadius:16,padding:"18px 15px",background:form.color||"var(--coral)"}}>
                <H size={4} style={{color:"#fff"}}>{form.name||"Your Room Name"}</H>
                <p style={{color:"rgba(255,255,255,.7)",fontSize:13,marginTop:4}}>{form.desc||"Room description..."}</p>
              </div>
            </div>
            <button className="btn btn-primary btn-md btn-full" disabled={!form.name||!form.desc} onClick={()=>setStep(2)}>Next: Battle Setup <ArrowRight size={15}/></button>
          </div>
        )}
        {step===2&&(
          <div className="fade-up">
            <div style={{marginBottom:14}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:7}}>FIRST BATTLE THEME</p>
              <input className="input" placeholder="e.g. Best meme about Mondays..." value={form.theme} onChange={e=>setForm(p=>({...p,theme:e.target.value}))}/>
            </div>
            <div style={{marginBottom:14}}>
              <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9}}>PRIZE STRUCTURE</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[{k:"free",I:Gift,l:"Free Battle",d:"Community glory"},{k:"usdc",I:DollarSign,l:"USDC Prize",d:"Real payout on Starknet"}].map(pt=>(
                  <div key={pt.k} onClick={()=>setForm(p=>({...p,prizeType:pt.k}))} style={{padding:"14px",borderRadius:15,border:`2px solid ${form.prizeType===pt.k?"var(--coral)":"var(--border)"}`,background:form.prizeType===pt.k?"var(--coral-lt)":"#fff",cursor:"pointer",transition:"all .15s",textAlign:"center"}}>
                    <pt.I size={24} color={form.prizeType===pt.k?"var(--coral)":"var(--muted)"} style={{margin:"0 auto 7px"}}/>
                    <p style={{fontWeight:700,fontSize:13,color:form.prizeType===pt.k?"var(--coral)":"var(--ink)"}}>{pt.l}</p>
                    <p style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{pt.d}</p>
                  </div>
                ))}
              </div>
            </div>
            {form.prizeType==="usdc"&&(
              <div style={{marginBottom:14}}>
                <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:7}}>PRIZE AMOUNT (USDC)</p>
                <input className="input" type="number" placeholder="100" value={form.prizeAmt} onChange={e=>setForm(p=>({...p,prizeAmt:e.target.value}))}/>
                <div style={{marginTop:8,padding:"10px 12px",background:"var(--amber-lt)",borderRadius:10,fontSize:12,color:"var(--amber)"}}>
                  <Zap size={12} style={{display:"inline",marginRight:4}}/>Funds are held in a Starknet escrow contract and auto-released to winners.
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-pale btn-md" style={{flex:.34}} onClick={()=>setStep(1)}><ArrowLeft size={14}/>Back</button>
              <button className="btn btn-primary btn-md" style={{flex:.66}} disabled={!form.theme} onClick={()=>setStep(3)}>Preview Launch <ArrowRight size={15}/></button>
            </div>
          </div>
        )}
        {step===3&&(
          <div className="fade-up">
            <div style={{borderRadius:22,padding:"24px 20px",background:form.color||"var(--coral)",marginBottom:18,textAlign:"center"}}>
              <Layers size={32} color="#fff" style={{margin:"0 auto 12px"}}/>
              <H size={2} style={{color:"#fff",marginBottom:7}}>{form.name}</H>
              <p style={{color:"rgba(255,255,255,.78)",fontSize:14,marginBottom:14}}>{form.desc}</p>
              {form.tags.map(t=><span key={t} style={{background:"rgba(255,255,255,.22)",color:"#fff",fontSize:11,padding:"4px 11px",borderRadius:99,fontWeight:700,marginRight:5}}>{t}</span>)}
            </div>
            {[{I:Swords,l:"First Battle",v:form.theme},{I:DollarSign,l:"Prize",v:form.prizeType==="usdc"?`$${form.prizeAmt} USDC`:"Community Glory"},{I:Zap,l:"Chain",v:"Starknet"}].map((s,i)=>(
              <div key={i} className="card" style={{padding:"13px 15px",marginBottom:9,display:"flex",gap:12,alignItems:"center"}}>
                <div style={{width:36,height:36,borderRadius:11,background:"var(--pale)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><s.I size={17} color="var(--coral)"/></div>
                <div><p style={{fontSize:11,color:"var(--muted)",fontWeight:600}}>{s.l}</p><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{s.v||"—"}</p></div>
              </div>
            ))}
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button className="btn btn-pale btn-md" style={{flex:.34}} onClick={()=>setStep(2)}><ArrowLeft size={14}/>Back</button>
              <button className="btn btn-primary btn-md" style={{flex:.66}} onClick={launch}>{loading?<Spinner/>:<>Launch Room <Zap size={15}/></>}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   EXPLORE
═══════════════════════════════════════════════════ */
const ExploreScreen = () => {
  const {navigate}=useApp();
  const [cat,setCat]=useState("All");
  const cats=["All","Memes","Creative","AI Art","Roasts","Captions","Design"];
  const filtered=cat==="All"?BATTLES:BATTLES.filter(b=>b.cat===cat);
  return (
    <div className="screen">
      <div className="header">
        <H size={2} style={{color:"var(--ink)",marginBottom:12}}>Explore</H>
        <div className="input-wrap" style={{marginBottom:12}}>
          <Search size={15} className="input-icon"/>
          <input className="input input-pad" placeholder="Search battles, rooms, creators..."/>
        </div>
        <div className="scroll-x">
          {cats.map(c=><button key={c} className={`chip ${cat===c?"chip-on":"chip-off"}`} onClick={()=>setCat(c)}>{c}</button>)}
        </div>
      </div>
      <div style={{padding:"12px 20px"}}>
        <H size={4} style={{color:"var(--ink)",marginBottom:10}}>Creator Rooms</H>
        <div className="scroll-x" style={{marginBottom:18}}>
          {ROOMS.map(r=>(
            <div key={r.id} className="card card-lift" style={{minWidth:140,padding:"14px 13px",cursor:"pointer",flexShrink:0}} onClick={()=>navigate("room-detail",r)}>
              <div style={{width:40,height:40,borderRadius:13,background:r.color,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:9}}><Layers size={18} color="#fff"/></div>
              <p style={{fontWeight:700,fontSize:14,color:"var(--ink)"}}>{r.name}</p>
              <p style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{r.members.toLocaleString()} members</p>
            </div>
          ))}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <H size={4} style={{color:"var(--ink)"}}>{cat==="All"?"All Battles":cat}</H>
          <button className="btn btn-ghost btn-icon btn-sm"><Filter size={14}/></button>
        </div>
        {filtered.map((b,i)=>(
          <div key={b.id} style={{marginBottom:12}}>
            <BattleCard b={b} onClick={()=>navigate(b.status==="voting"?"voting":b.status==="completed"?"winner":"battle",b)}/>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   LEADERBOARD
═══════════════════════════════════════════════════ */
const LeaderboardScreen = () => {
  const {navigate}=useApp();
  const [tab,setTab]=useState("week");
  return (
    <div className="screen">
      <div className="header">
        <H size={2} style={{color:"var(--ink)",marginBottom:12}}>Leaderboard</H>
        <div style={{display:"flex",gap:4,background:"var(--pale)",borderRadius:13,padding:4}}>
          {[{k:"today",l:"Today"},{k:"week",l:"This Week"},{k:"alltime",l:"All Time"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all .15s",background:tab===t.k?"#fff":"transparent",color:tab===t.k?"var(--ink)":"var(--muted)",boxShadow:tab===t.k?"0 2px 8px rgba(0,0,0,.06)":"none"}}>{t.l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",gap:12,padding:"18px 0 22px"}}>
          {[CREATORS[1],CREATORS[0],CREATORS[2]].map((c,i)=>{
            const heights=[96,128,78];
            const bgColors=["#E5E7EB","#FEF9C3","#FEF3C7"];
            return (
              <div key={c.rank} className="fade-up" style={{textAlign:"center",flex:1,animationDelay:`${i*.07}s`}}>
                <InitialAvatar name={c.name} size={i===1?52:40} color={c.color}/>
                <p style={{fontWeight:700,fontSize:12,color:"var(--ink)",margin:"6px 0 4px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</p>
                <div style={{height:heights[i],borderRadius:"11px 11px 0 0",background:bgColors[i],display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:10}}>
                  {i===1?<Crown size={22} color="var(--amber)"/>:i===0?<Medal size={18} color="var(--slate)"/>:<Medal size={16} color="var(--amber)"/>}
                </div>
              </div>
            );
          })}
        </div>
        {CREATORS.map((c,i)=>(
          <div key={c.rank} className="lb-row fade-up" style={{animationDelay:`${i*.05}s`}} onClick={()=>navigate("profile")}>
            <div style={{width:32,height:32,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",background:i<3?"var(--amber-lt)":"var(--pale)",flexShrink:0}}>
              {i<3?<Trophy size={15} color="var(--amber)"/>:<span style={{fontWeight:800,fontSize:14,color:"var(--muted)"}}>{c.rank}</span>}
            </div>
            <InitialAvatar name={c.name} size={38} color={c.color}/>
            <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{c.name}</p><p style={{fontSize:12,color:"var(--muted)"}}>@{c.handle} · {c.wins} wins</p></div>
            <div style={{textAlign:"right"}}><H size={4} style={{color:"var(--coral)"}}>{c.xp.toLocaleString()}</H><p style={{fontSize:11,color:"var(--muted)"}}>XP</p></div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════ */
const NotificationsScreen = () => {
  const {navigate}=useApp();
  return (
    <div className="screen">
      <div className="header">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button className="btn btn-ghost btn-icon" onClick={()=>navigate("home")}><ArrowLeft size={20}/></button>
          <H size={3} style={{color:"var(--ink)"}}>Notifications</H>
        </div>
      </div>
      <div style={{padding:"10px 20px"}}>
        {["NEW","EARLIER"].map(sec=>(
          <div key={sec}>
            <p style={{fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:7,letterSpacing:".07em"}}>{sec}</p>
            {NOTIFS.filter(n=>sec==="NEW"?!n.read:n.read).map((n,i)=>(
              <div key={n.id} className="notif-row fade-up" style={{animationDelay:`${i*.05}s`,borderLeft:!n.read?"3px solid var(--coral)":"none"}}>
                <div style={{width:36,height:36,borderRadius:11,background:!n.read?"var(--coral-lt)":"var(--pale)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:!n.read?"var(--coral)":"var(--muted)"}}>
                  <NotifIcon type={n.icon}/>
                </div>
                <div style={{flex:1}}>
                  <p style={{fontWeight:!n.read?700:600,color:"var(--ink)",fontSize:14,marginBottom:2}}>{n.msg}</p>
                  {n.sub&&<p style={{color:"var(--muted)",fontSize:12,marginBottom:4}}>{n.sub}</p>}
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:11,color:"var(--muted)"}}>{n.time}</span>
                    {n.action&&<button className="btn btn-sm" style={{padding:"4px 10px",fontSize:11,background:"var(--coral-lt)",color:"var(--coral)",borderRadius:8}}>{n.action==="claim"?"Claim":"Join"} <ArrowRight size={11}/></button>}
                  </div>
                </div>
                {!n.read&&<div style={{width:8,height:8,borderRadius:"50%",background:"var(--coral)",flexShrink:0,marginTop:5}}/>}
              </div>
            ))}
            <Spacer h={4}/>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   PROFILE
═══════════════════════════════════════════════════ */
const ProfileScreen = () => {
  const {navigate,user}=useApp();
  const [tab,setTab]=useState("wins");
  const BADGES=[
    {n:"First Win",I:Trophy,c:"var(--amber)",earned:true,r:"Common"},{n:"Hot Streak",I:Flame,c:"var(--coral)",earned:true,r:"Rare"},
    {n:"Crowd Fave",I:Heart,c:"#EC4899",earned:true,r:"Rare"},{n:"Speed Demon",I:Zap,c:"var(--violet)",earned:false,r:"Uncommon"},
    {n:"Legend",I:Crown,c:"var(--amber)",earned:false,r:"Legendary"},{n:"Viral",I:TrendingUp,c:"var(--sky)",earned:false,r:"Epic"},
    {n:"Creator",I:Layers,c:"var(--mint)",earned:false,r:"Uncommon"},{n:"Top 3 Weekly",I:Medal,c:"var(--coral)",earned:false,r:"Rare"},
    {n:"Sponsor",I:Gift,c:"var(--violet)",earned:false,r:"Rare"},
  ];
  return (
    <div className="screen">
      <div style={{background:"var(--grad-night)",padding:"48px 20px 22px",position:"relative"}}>
        <button className="btn btn-icon" style={{position:"absolute",top:14,right:14,background:"rgba(255,255,255,.12)",color:"rgba(255,255,255,.7)"}} onClick={()=>navigate("home")}><Settings size={17}/></button>
        <div style={{display:"flex",gap:15,alignItems:"flex-start",marginBottom:18}}>
          <div style={{position:"relative"}}>
            <InitialAvatar name={user?.name||"F"} size={72} color="var(--coral)"/>
            <div style={{position:"absolute",bottom:-4,right:-4,background:"var(--amber)",width:24,height:24,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #141420"}}>
              <Zap size={13} color="#fff"/>
            </div>
          </div>
          <div style={{flex:1}}>
            <H size={3} style={{color:"#fff"}}>{user?.name||"FlameKing99"}</H>
            <p style={{color:"rgba(255,255,255,.55)",fontSize:13,marginBottom:8}}>@flameking · Breakout</p>
            <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:700,color:"var(--amber)",background:"rgba(217,119,6,.25)",padding:"3px 10px",borderRadius:99}}>Breakout</span>
              <span style={{fontSize:11,fontWeight:700,color:"var(--mint)",background:"rgba(0,184,150,.2)",padding:"3px 10px",borderRadius:99,display:"flex",alignItems:"center",gap:4}}><Flame size={10}/>7 Streak</span>
            </div>
          </div>
        </div>
        <div style={{background:"rgba(255,255,255,.08)",borderRadius:14,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:12}}>Breakout → Icon</span>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:12}}>6,430 / 8,000 XP</span>
          </div>
          <XPBar pct={(6430/8000)*100}/>
        </div>
      </div>
      <div style={{padding:"14px 20px 0"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[{l:"Battles",v:"47",I:Swords},{l:"Wins",v:"23",I:Trophy},{l:"Streak",v:"7",I:Flame},{l:"Earned",v:"$840",I:DollarSign}].map((s,i)=>(
            <div key={i} className="card fade-up" style={{padding:"12px 7px",textAlign:"center",animationDelay:`${i*.05}s`}}>
              <s.I size={14} color="var(--coral)" style={{margin:"0 auto 5px"}}/>
              <H size={3} style={{color:"var(--ink)"}}>{s.v}</H>
              <p style={{fontSize:10,color:"var(--muted)",marginTop:1}}>{s.l}</p>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:4,background:"var(--pale)",borderRadius:13,padding:4,marginBottom:14}}>
          {[{k:"wins",l:"Wins"},{k:"badges",l:"Badges"},{k:"entries",l:"Entries"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all .15s",background:tab===t.k?"#fff":"transparent",color:tab===t.k?"var(--ink)":"var(--muted)",boxShadow:tab===t.k?"0 2px 8px rgba(0,0,0,.06)":"none"}}>{t.l}</button>
          ))}
        </div>
        {tab==="wins"&&BATTLES.slice(0,4).map((b,i)=>(
          <div key={b.id} className="card fade-up" style={{padding:"13px 15px",marginBottom:9,cursor:"pointer",animationDelay:`${i*.06}s`}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <GradBlock grad={b.grad} size={44}><Swords size={18} color="#fff"/></GradBlock>
              <div style={{flex:1}}><p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{b.title}</p><p style={{fontSize:12,color:"var(--muted)"}}>{b.prize} · 1st Place</p></div>
              <Trophy size={18} color="var(--amber)"/>
            </div>
          </div>
        ))}
        {tab==="badges"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9}}>
            {BADGES.map((b,i)=>(
              <div key={b.n} className="card fade-up" style={{padding:"14px 9px",textAlign:"center",opacity:b.earned?1:.38,animationDelay:`${i*.04}s`}}>
                <div style={{width:40,height:40,borderRadius:13,background:b.earned?`${b.c}18`:"var(--pale)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 7px"}}><b.I size={19} color={b.earned?b.c:"var(--ghost)"}/></div>
                <p style={{fontWeight:700,fontSize:11,color:"var(--ink)",marginBottom:2}}>{b.n}</p>
                <span style={{fontSize:10,fontWeight:700,color:b.r==="Legendary"?"var(--amber)":b.r==="Epic"?"var(--violet)":b.r==="Rare"?"var(--sky)":"var(--mint)",background:"transparent"}}>{b.r}</span>
              </div>
            ))}
          </div>
        )}
        {tab==="entries"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
            {Array.from({length:9}).map((_,i)=>(
              <div key={i} className="fade-up" style={{aspectRatio:"1",borderRadius:12,overflow:"hidden",animationDelay:`${i*.03}s`}}>
                <img src={`https://picsum.photos/seed/e${i}/200/200`} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              </div>
            ))}
          </div>
        )}
        <Spacer h={14}/>
        <div className="card" style={{padding:"18px",background:"var(--grad-night)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:13}}>
            <div>
              <p style={{color:"rgba(255,255,255,.5)",fontSize:12,marginBottom:3}}>Total Earned</p>
              <H size={2} style={{color:"#fff"}}>$840 <span style={{fontSize:13,opacity:.5}}>USDC</span></H>
            </div>
            <div style={{width:44,height:44,borderRadius:14,background:"rgba(255,255,255,.1)",display:"flex",alignItems:"center",justifyContent:"center"}}><DollarSign size={22} color="#fff"/></div>
          </div>
          <div style={{display:"flex",gap:9}}>
            <button className="btn btn-primary btn-sm" style={{flex:1}} onClick={()=>navigate("wallet")}>Claim Rewards</button>
            <button className="btn btn-sm" style={{flex:1,background:"rgba(255,255,255,.12)",color:"rgba(255,255,255,.7)",borderRadius:12}}>History</button>
          </div>
          <p style={{color:"rgba(255,255,255,.28)",fontSize:10,marginTop:9,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><Zap size={10}/>Powered by Starknet</p>
        </div>
        <Spacer h={18}/>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   WALLET / REWARDS SCREEN
═══════════════════════════════════════════════════ */
const WalletScreen = () => {
  const {navigate,wallet,connectWallet,disconnectWallet}=useApp();
  const [claiming,setClaiming]=useState(null);
  const [claimed,setClaimed]=useState([]);
  const [tab,setTab]=useState("rewards");
  const rewards=[
    {id:1,battle:"Monday Meme Battle",place:"2nd",amount:"$84.00",status:"pending",date:"Today"},
    {id:2,battle:"Caption Challenge",place:"1st",amount:"$140.00",status:"pending",date:"2 days ago"},
    {id:3,battle:"AI Remix Arena",place:"3rd",amount:"$60.00",status:"claimed",date:"5 days ago"},
    {id:4,battle:"Roast Battle",place:"1st",amount:"$120.00",status:"claimed",date:"1 week ago"},
  ];
  const txHistory=[
    {type:"reward",desc:"AI Remix Arena · 3rd Place",amount:"+$60",date:"5 days ago",hash:"0x1a2b...3c4d"},
    {type:"reward",desc:"Roast Battle · 1st Place",amount:"+$120",date:"1 week ago",hash:"0x5e6f...7a8b"},
    {type:"fee",desc:"Entry fee",amount:"-$5",date:"1 week ago",hash:"0x9c0d...1e2f"},
  ];
  const pending=rewards.filter(r=>r.status==="pending"&&!claimed.includes(r.id));
  const totalPending=pending.reduce((s,r)=>s+parseFloat(r.amount.replace("$","")),0);
  const doClaim=(id)=>{if(!wallet.connected) return;setClaiming(id);setTimeout(()=>{setClaiming(null);setClaimed(p=>[...p,id]);},1600);};
  return (
    <div className="screen">
      <div className="header">
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button className="btn btn-ghost btn-icon" onClick={()=>navigate("profile")}><ArrowLeft size={20}/></button>
          <H size={3} style={{color:"var(--ink)"}}>Rewards & Wallet</H>
        </div>
      </div>
      <div style={{padding:"0 20px"}}>
        <div className="card fade-up" style={{padding:"22px 18px",marginBottom:14,background:"var(--grad-night)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <p style={{color:"rgba(255,255,255,.5)",fontSize:12,marginBottom:4}}>Total Earnings</p>
              <H size={1} style={{color:"#fff",lineHeight:1}}>$840</H>
              <p style={{color:"rgba(255,255,255,.4)",fontSize:13,marginTop:4}}>USDC · Starknet</p>
            </div>
            <div style={{background:"rgba(255,255,255,.1)",borderRadius:12,padding:"8px 12px",textAlign:"right"}}>
              <p style={{color:"rgba(255,255,255,.5)",fontSize:10,marginBottom:2}}>Pending</p>
              <H size={4} style={{color:"var(--amber)"}}>${totalPending.toFixed(2)}</H>
            </div>
          </div>
          {!wallet.connected?(
            <button className="btn btn-primary btn-lg btn-full" onClick={connectWallet}>
              <Wallet size={17}/>Connect Wallet to Claim
            </button>
          ):(
            <div>
              <div style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:"11px 13px",marginBottom:10,display:"flex",gap:9,alignItems:"center"}}>
                <div style={{width:9,height:9,background:"var(--mint)",borderRadius:"50%",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <p style={{color:"rgba(255,255,255,.45)",fontSize:10}}>Connected</p>
                  <p style={{color:"#fff",fontWeight:700,fontSize:13,fontFamily:"monospace"}}>{wallet.address}</p>
                </div>
                <button className="btn btn-ghost btn-icon" style={{color:"rgba(255,255,255,.4)",width:28,height:28}} onClick={()=>{try{navigator.clipboard.writeText(wallet.fullAddress||"");}catch(e){}}}><Copy size={13}/></button>
              </div>
              <div style={{display:"flex",gap:9}}>
                <button className="btn btn-primary btn-md" style={{flex:1}} onClick={()=>pending.forEach(r=>doClaim(r.id))}>Claim All ${totalPending.toFixed(0)}</button>
                <button className="btn btn-md" style={{flex:.38,background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.65)",borderRadius:12}} onClick={disconnectWallet}>Disconnect</button>
              </div>
            </div>
          )}
          <p style={{color:"rgba(255,255,255,.25)",fontSize:10,marginTop:10,textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><Zap size={10}/>Instant settlements · No gas fees for claims</p>
        </div>
        <div style={{display:"flex",gap:4,background:"var(--pale)",borderRadius:13,padding:4,marginBottom:14}}>
          {[{k:"rewards",l:"Rewards"},{k:"history",l:"History"},{k:"info",l:"How it Works"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:11,cursor:"pointer",transition:"all .15s",background:tab===t.k?"#fff":"transparent",color:tab===t.k?"var(--ink)":"var(--muted)",boxShadow:tab===t.k?"0 2px 8px rgba(0,0,0,.06)":"none"}}>{t.l}</button>
          ))}
        </div>
        {tab==="rewards"&&rewards.map((r,i)=>{
          const isClaimed=r.status==="claimed"||claimed.includes(r.id);
          const placeIcon=r.place==="1st"?<Crown size={16} color="var(--amber)"/>:r.place==="2nd"?<Medal size={16} color="var(--slate)"/>:<Medal size={16} color="var(--amber)"/>;
          return (
            <div key={r.id} className="card fade-up" style={{padding:"15px",marginBottom:9,animationDelay:`${i*.05}s`}}>
              <div style={{display:"flex",gap:13,alignItems:"center"}}>
                <div style={{width:42,height:42,borderRadius:14,background:isClaimed?"var(--pale)":"var(--amber-lt)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {isClaimed?<CheckCircle size={18} color="var(--mint)"/>:placeIcon}
                </div>
                <div style={{flex:1}}>
                  <p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{r.battle}</p>
                  <p style={{fontSize:12,color:"var(--muted)"}}>{r.place} Place · {r.date}</p>
                </div>
                <div style={{textAlign:"right"}}>
                  <H size={4} style={{color:"var(--coral)"}}>{r.amount}</H>
                  {!isClaimed&&<button className="btn btn-sm btn-primary" style={{marginTop:5,padding:"5px 12px",fontSize:11}} onClick={()=>doClaim(r.id)} disabled={!wallet.connected||claiming===r.id}>{claiming===r.id?<Spinner size={12}/>:"Claim"}</button>}
                  {isClaimed&&<p style={{fontSize:11,color:"var(--mint)",fontWeight:700,marginTop:3}}>Claimed</p>}
                </div>
              </div>
              {!wallet.connected&&!isClaimed&&<div style={{marginTop:9,padding:"7px 11px",background:"var(--amber-lt)",borderRadius:9,fontSize:11,color:"var(--amber)",display:"flex",alignItems:"center",gap:6}}><AlertCircle size={12}/>Connect wallet to claim</div>}
            </div>
          );
        })}
        {tab==="history"&&txHistory.map((tx,i)=>(
          <div key={i} className="card fade-up" style={{padding:"13px 15px",marginBottom:9,animationDelay:`${i*.05}s`}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{width:38,height:38,borderRadius:13,background:tx.type==="reward"?"var(--mint-lt)":"var(--coral-lt)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {tx.type==="reward"?<TrendingUp size={16} color="var(--mint)"/>:<TrendingDown size={16} color="var(--coral)"/>}
              </div>
              <div style={{flex:1}}>
                <p style={{fontWeight:600,color:"var(--ink)",fontSize:13}}>{tx.desc}</p>
                <p style={{fontSize:11,color:"var(--muted)",marginTop:2,display:"flex",alignItems:"center",gap:5}}>{tx.date}<span style={{fontFamily:"monospace",fontSize:10}}>{tx.hash}</span><ExternalLink size={10}/></p>
              </div>
              <H size={4} style={{color:tx.type==="reward"?"var(--mint)":"var(--coral)"}}>{tx.amount}</H>
            </div>
          </div>
        ))}
        {tab==="info"&&[
          {I:Trophy,c:"var(--coral)",t:"Win Battles",b:"Enter daily battles. Community votes. Top entries win USDC prize pools."},
          {I:Wallet,c:"var(--violet)",t:"Connect Your Wallet",b:"Link any Starknet wallet (ArgentX, Braavos) to receive USDC directly on-chain."},
          {I:DollarSign,c:"var(--mint)",t:"Claim Your Prize",b:"Winnings are held in transparent escrow on Starknet. Claim anytime, no expiry."},
          {I:Zap,c:"var(--amber)",t:"Instant & Feeless",b:"Starknet L2 means near-instant transfers with near-zero gas. You keep almost everything."},
          {I:Shield,c:"var(--sky)",t:"Non-Custodial",b:"Smart contracts auto-release funds. We never hold your winnings a moment longer than needed."},
        ].map((s,i)=>(
          <div key={i} className="card fade-up" style={{padding:"15px",marginBottom:9,animationDelay:`${i*.05}s`}}>
            <div style={{display:"flex",gap:13}}>
              <div style={{width:38,height:38,borderRadius:12,background:`${s.c}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><s.I size={18} color={s.c}/></div>
              <div><p style={{fontWeight:700,color:"var(--ink)",marginBottom:3,fontSize:14}}>{s.t}</p><p style={{fontSize:13,color:"var(--muted)",lineHeight:1.55}}>{s.b}</p></div>
            </div>
          </div>
        ))}
        <Spacer h={14}/>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   SUBMIT MODAL
═══════════════════════════════════════════════════ */
const SubmitModal = ({onClose,onSuccess}) => {
  const [step,setStep]=useState(1);
  const [type,setType]=useState(null);
  const [caption,setCaption]=useState("");
  const [selBattle,setSelBattle]=useState(0);
  const [loading,setLoading]=useState(false);
  const [dragging,setDragging]=useState(false);
  const types=[{I:Image,l:"Image / Meme"},{I:Type,l:"Text Entry"},{I:Camera,l:"Camera"},{I:Shuffle,l:"AI Remix"}];
  const submit=()=>{setLoading(true);setTimeout(()=>{onClose();onSuccess();},1200);};
  return (
    <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <H size={3} style={{color:"var(--ink)"}}>{step===1?"Choose Weapon":step===2?"Add Your Entry":"Ready to Submit?"}</H>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={19}/></button>
        </div>
        {step===1&&(
          <div className="scale-in">
            <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9,letterSpacing:".05em"}}>PICK A BATTLE</p>
            {BATTLES.filter(b=>b.status==="live").slice(0,3).map((b,i)=>(
              <div key={b.id} onClick={()=>setSelBattle(i)} style={{display:"flex",gap:12,alignItems:"center",padding:"11px 13px",borderRadius:14,marginBottom:7,cursor:"pointer",border:`2px solid ${selBattle===i?"var(--coral)":"var(--border)"}`,background:selBattle===i?"var(--coral-lt)":"#fff",transition:"all .15s"}}>
                <GradBlock grad={b.grad} size={40}><Swords size={16} color="#fff"/></GradBlock>
                <div style={{flex:1}}><p style={{fontWeight:700,fontSize:13,color:"var(--ink)"}}>{b.title}</p><p style={{fontSize:11,color:"var(--muted)"}}>{b.prize} · {b.timeLeft} left</p></div>
                {selBattle===i&&<Check size={16} color="var(--coral)"/>}
              </div>
            ))}
            <p style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:9,marginTop:14,letterSpacing:".05em"}}>ENTRY TYPE</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:18}}>
              {types.map(t=>(
                <button key={t.l} onClick={()=>setType(t.l)} style={{padding:"13px 9px",borderRadius:14,border:`2px solid ${type===t.l?"var(--coral)":"var(--border)"}`,background:type===t.l?"var(--coral-lt)":"#fff",cursor:"pointer",transition:"all .15s",fontFamily:"'Plus Jakarta Sans',sans-serif",textAlign:"center"}}>
                  <t.I size={22} color={type===t.l?"var(--coral)":"var(--muted)"} style={{margin:"0 auto 6px"}}/>
                  <p style={{fontWeight:700,fontSize:12,color:type===t.l?"var(--coral)":"var(--ink)"}}>{t.l}</p>
                </button>
              ))}
            </div>
            <button className="btn btn-primary btn-md btn-full" disabled={!type} onClick={()=>setStep(2)}>Continue <ArrowRight size={15}/></button>
          </div>
        )}
        {step===2&&(
          <div className="scale-in">
            <div className={`upload-zone ${dragging?"dragging":""}`} style={{height:170,marginBottom:12}} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);}}>
              <Upload size={28} color={dragging?"var(--coral)":"var(--ghost)"}/>
              <p style={{fontWeight:700,color:"var(--ink)",fontSize:14}}>{type==="Text Entry"?"Write your entry below":"Drop your file here"}</p>
              {type!=="Text Entry"&&<p style={{fontSize:12,color:"var(--muted)"}}>JPG, PNG, GIF up to 10MB</p>}
            </div>
            <textarea className="input" placeholder={type==="Text Entry"?"Write your entry here...":"Add a caption (optional)..."} rows={3} value={caption} onChange={e=>setCaption(e.target.value)} style={{marginBottom:10}}/>
            <div style={{fontSize:12,color:"var(--muted)",marginBottom:14,padding:"9px 12px",background:"var(--pale)",borderRadius:10}}>Original content only. Entries are reviewed before going live.</div>
            <div style={{display:"flex",gap:9}}>
              <button className="btn btn-pale btn-md" style={{flex:.36}} onClick={()=>setStep(1)}><ArrowLeft size={14}/>Back</button>
              <button className="btn btn-primary btn-md" style={{flex:.64}} onClick={()=>setStep(3)}>Preview <ArrowRight size={15}/></button>
            </div>
          </div>
        )}
        {step===3&&(
          <div className="scale-in">
            <div className="card" style={{padding:"15px",marginBottom:14}}>
              <div style={{display:"flex",gap:13,alignItems:"center",marginBottom:11}}>
                <GradBlock grad={BATTLES[selBattle]?.grad||"var(--grad-fire)"} size={42}><Swords size={17} color="#fff"/></GradBlock>
                <div><p style={{fontWeight:700,color:"var(--ink)"}}>{BATTLES[selBattle]?.title}</p><p style={{fontSize:12,color:"var(--muted)"}}>{type}</p></div>
              </div>
              <div style={{background:"var(--pale)",borderRadius:11,padding:"13px",fontSize:13,color:"var(--ink)",lineHeight:1.55}}>{caption||"(image entry)"}</div>
            </div>
            <div style={{padding:"10px 13px",background:"var(--amber-lt)",borderRadius:11,marginBottom:14,fontSize:12,color:"var(--amber)",lineHeight:1.55}}>
              <AlertCircle size={12} style={{display:"inline",marginRight:5}}/>Once submitted, your entry enters the arena for community voting. You cannot edit it.
            </div>
            <div style={{display:"flex",gap:9}}>
              <button className="btn btn-pale btn-md" style={{flex:.34}} onClick={()=>setStep(2)}><ArrowLeft size={14}/>Back</button>
              <button className="btn btn-primary btn-md" style={{flex:.66}} onClick={submit}>{loading?<Spinner/>:<>Submit Entry <Zap size={15}/></>}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   CELEBRATION OVERLAY
═══════════════════════════════════════════════════ */
const CelebrationOverlay = ({onClose}) => (
  <div style={{position:"fixed",inset:0,zIndex:400,background:"var(--grad-fire)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 32px"}}>
    <ConfettiPiece/>
    <div style={{textAlign:"center",position:"relative",zIndex:1}}>
      <div className="float-anim" style={{width:88,height:88,borderRadius:28,background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}><CheckCircle size={44} color="#fff"/></div>
      <H size={1} style={{color:"#fff",marginBottom:8}}>You're In</H>
      <p style={{color:"rgba(255,255,255,.85)",fontSize:16,marginBottom:26,lineHeight:1.6}}>Entry submitted.<br/>May the best creator win.</p>
      <div style={{background:"rgba(255,255,255,.18)",borderRadius:20,padding:"16px 28px",marginBottom:24}}>
        <H size={2} style={{color:"#fff"}}>+200 XP</H>
        <p style={{color:"rgba(255,255,255,.65)",fontSize:13,marginTop:4}}>Keep your streak going</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:9,width:"100%"}}>
        <button className="btn btn-lg btn-full" style={{background:"rgba(255,255,255,.94)",color:"var(--coral)",fontWeight:800,borderRadius:16}}><Share2 size={17}/> Share Entry</button>
        <button className="btn btn-lg btn-full" style={{background:"rgba(255,255,255,.16)",color:"#fff",borderRadius:16}} onClick={onClose}>Back to Arena</button>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════
   BOTTOM NAV
═══════════════════════════════════════════════════ */
const BottomNav = ({active,navigate,setShowCreate}) => {
  const items=[{I:Home,l:"Home",k:"home"},{I:Search,l:"Explore",k:"explore"},null,{I:Layers,l:"Rooms",k:"rooms"},{I:User,l:"Profile",k:"profile"}];
  return (
    <nav className="bot-nav">
      {items.map((item,i)=>item===null?(
        <button key="c" className="nav-plus" onClick={()=>setShowCreate(true)}><Plus size={24} color="#fff" strokeWidth={2.5}/></button>
      ):(
        <button key={item.k} className={`nav-btn ${active===item.k?"on":"off"}`} onClick={()=>navigate(item.k)}>
          <item.I size={21}/><span className="nav-lbl">{item.l}</span>
        </button>
      ))}
    </nav>
  );
};

/* ═══════════════════════════════════════════════════
   DESKTOP SIDEBAR
═══════════════════════════════════════════════════ */
const SidebarLeft = ({screen,navigate,setShowCreate}) => {
  const {wallet,user}=useApp();
  const items=[{I:Home,l:"Home",k:"home"},{I:Search,l:"Explore",k:"explore"},{I:Layers,l:"Rooms",k:"rooms"},{I:Trophy,l:"Leaderboard",k:"leaderboard"},{I:Bell,l:"Notifications",k:"notifications"},{I:User,l:"Profile",k:"profile"},{I:Wallet,l:"Wallet",k:"wallet"}];
  return (
    <div className="sidebar-l">
      <div style={{padding:"0 8px 10px"}}>
        <H size={3} style={{color:"var(--ink)",letterSpacing:"-.02em",lineHeight:1}}>Meme<span className="gradient-text">Arena</span></H>
        <p style={{fontSize:11,color:"var(--muted)",marginTop:3}}>Starknet · L2</p>
      </div>
      {items.map(item=>(
        <button key={item.k} className={`snav ${screen===item.k?"on":"off"}`} onClick={()=>navigate(item.k)}>
          <item.I size={18}/>{item.l}
        </button>
      ))}
      <button className="btn btn-primary btn-md" style={{marginTop:8,width:"100%",borderRadius:13}} onClick={()=>setShowCreate(true)}>
        <Plus size={16}/>Submit Entry
      </button>
      <Divider margin="12px 0"/>
      <div style={{background:"var(--pale)",borderRadius:14,padding:"11px 13px"}}>
        <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:5}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:wallet.connected?"var(--mint)":"var(--ghost)"}}/>
          <span style={{fontSize:11,color:"var(--muted)",fontWeight:600}}>{wallet.connected?"Starknet Connected":"No Wallet"}</span>
        </div>
        <H size={4} style={{color:"var(--ink)"}}>$840 USDC</H>
        <p style={{fontSize:11,color:"var(--muted)",marginTop:1}}>{user?.name||"FlameKing99"}</p>
      </div>
    </div>
  );
};
const SidebarRight = ({navigate}) => (
  <div className="sidebar-r">
    <div className="card" style={{padding:"15px"}}>
      <H size={4} style={{color:"var(--ink)",marginBottom:11}}>Hot Right Now</H>
      {BATTLES.filter(b=>b.status==="live").map(b=>(
        <div key={b.id} style={{display:"flex",gap:10,alignItems:"center",marginBottom:11,cursor:"pointer"}} onClick={()=>navigate("battle",b)}>
          <GradBlock grad={b.grad} size={40}><Swords size={16} color="#fff"/></GradBlock>
          <div><p style={{fontWeight:700,fontSize:13,color:"var(--ink)"}}>{b.title}</p><p style={{fontSize:11,color:"var(--muted)"}}>{b.prize} · {b.participants} in</p></div>
        </div>
      ))}
    </div>
    <div className="card" style={{padding:"15px"}}>
      <H size={4} style={{color:"var(--ink)",marginBottom:11}}>Top This Week</H>
      {CREATORS.slice(0,4).map((c,i)=>(
        <div key={c.rank} style={{display:"flex",gap:9,alignItems:"center",marginBottom:9,cursor:"pointer"}}>
          <span style={{width:22,height:22,borderRadius:7,background:i<3?"var(--amber-lt)":"var(--pale)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {i<3?<Trophy size={11} color="var(--amber)"/>:<span style={{fontSize:11,fontWeight:700,color:"var(--muted)"}}>{i+1}</span>}
          </span>
          <InitialAvatar name={c.name} size={28} color={c.color}/>
          <div style={{flex:1}}><p style={{fontWeight:700,fontSize:12,color:"var(--ink)"}}>{c.name}</p><p style={{fontSize:10,color:"var(--muted)"}}>{c.wins} wins</p></div>
        </div>
      ))}
    </div>
    <div className="card" style={{padding:"13px"}}>
      <H size={4} style={{color:"var(--ink)",marginBottom:7}}>Starknet Status</H>
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:"var(--mint)"}}/>
        <span style={{fontSize:12,color:"var(--muted)"}}>All systems operational</span>
      </div>
      <p style={{fontSize:11,color:"var(--muted)"}}>Avg block: 2s · Gas: ~$0.001</p>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════ */
export default function MemeArena() {
  const [screen,setScreen]=useState("onboarding");
  const [screenData,setScreenData]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [showCelebration,setShowCelebration]=useState(false);
  const [user,setUser]=useState(null);
  const [wallet,setWallet]=useState({connected:false,address:null,fullAddress:null});

  const navigate=(s,data=null)=>{setScreenData(data);setScreen(s);window.scrollTo(0,0);};
  const login=(u)=>setUser(u);
  const connectWallet=()=>setTimeout(()=>setWallet({connected:true,address:"0x04a9...2b8f",fullAddress:"0x04a9e3b5c1d7f8a2e4b6c8d0f2a4b8c0d2f4",balance:"$840.00"}),700);
  const disconnectWallet=()=>setWallet({connected:false,address:null,fullAddress:null});

  const unread=NOTIFS.filter(n=>!n.read).length;
  const ctx={navigate,user,login,wallet,connectWallet,disconnectWallet,showCreate,setShowCreate,notifCount:unread};

  const renderScreen=()=>{
    switch(screen){
      case "onboarding":   return <OnboardingScreen/>;
      case "home":         return <HomeScreen/>;
      case "explore":      return <ExploreScreen/>;
      case "rooms":        return <RoomsScreen/>;
      case "room-detail":  return <RoomDetailScreen room={screenData}/>;
      case "create-room":  return <CreateRoomScreen/>;
      case "battle":       return <BattleDetailScreen battle={screenData}/>;
      case "voting":       return <VotingScreen battle={screenData}/>;
      case "winner":       return <WinnerScreen battle={screenData}/>;
      case "leaderboard":  return <LeaderboardScreen/>;
      case "notifications":return <NotificationsScreen/>;
      case "profile":      return <ProfileScreen/>;
      case "wallet":       return <WalletScreen/>;
      default:             return <HomeScreen/>;
    }
  };
  const showNav=!["onboarding","voting"].includes(screen);
  return (
    <Ctx.Provider value={ctx}>
      <style dangerouslySetInnerHTML={{__html:CSS}}/>
      <div className="wide-layout">
        {showNav&&screen!=="onboarding"&&<SidebarLeft screen={screen} navigate={navigate} setShowCreate={setShowCreate}/>}
        <div className="app-shell">
          {renderScreen()}
          {showNav&&<BottomNav active={screen} navigate={navigate} setShowCreate={setShowCreate}/>}
        </div>
        {showNav&&screen!=="onboarding"&&<SidebarRight navigate={navigate}/>}
      </div>
      {showCreate&&<SubmitModal onClose={()=>setShowCreate(false)} onSuccess={()=>{setShowCreate(false);setShowCelebration(true);}}/>}
      {showCelebration&&<CelebrationOverlay onClose={()=>setShowCelebration(false)}/>}
    </Ctx.Provider>
  );
}

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
    {Array.from({length:28}).map((_,i)

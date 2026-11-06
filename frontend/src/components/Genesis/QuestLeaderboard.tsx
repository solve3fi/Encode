"use client";
import { useEffect, useState } from "react";
import { validateLeaderboard } from "../../../scripts/quest/quest-leaderboard.mjs";
import classes from "./Quests.module.css";

type Entry = { publicId: string; label: string; rank: number; totalXp: string; questXp: string; votingXp: string };
type Board = { asOf: string; entries: Entry[] };
export function QuestLeaderboard() {
 const [board,setBoard]=useState<Board|null>(null);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  let active=true; const controller=new AbortController();
  async function load(){
   try {
    const response=await fetch("/api/quest-leaderboard",{credentials:"omit",signal:controller.signal});
    if(!response.ok)throw new Error("Unavailable");
    const value=validateLeaderboard(await response.json()) as Board;
    if(active){setBoard(value);setFailed(false);}
   }catch{if(active)setFailed(true);}
  }
  void load(); const timer=setInterval(()=>void load(),30000);
  return ()=>{active=false;controller.abort();clearInterval(timer);};
 },[]);
 return <section className={`${classes.card} ${classes.panel}`} aria-label="Devnet leaderboard">
  <span className={classes.eyebrow}>Devnet preseason</span>
  <h3>Leaderboard</h3>
  <p className={classes.muted}>Top 50 by net Quest XP + Voting XP. Public aliases keep wallets private. XP resets at Genesis.</p>
  {failed&&<p role="status">Leaderboard temporarily unavailable.{board?" Showing the last update.":""}</p>}
  {!board&&!failed&&<p role="status">Loading rankings…</p>}
  {board&&board.entries.length===0&&<p>No recorded XP yet. Earn your first quest XP to join.</p>}
  {board&&<ol className={classes.leaderboard}>
   {board.entries.map(row=><li key={row.publicId} className={classes.leaderboardRow}>
    <span className={classes.amber}>#{row.rank}</span>
    <span className={classes.leaderboardName}><strong>{row.label}</strong><small>
     {BigInt(row.questXp).toLocaleString()} Quest · {BigInt(row.votingXp).toLocaleString()} Voting
    </small></span>
    <strong title={`${row.totalXp} XP`}>{BigInt(row.totalXp).toLocaleString()} XP</strong>
   </li>)}
  </ol>}
  {board&&<small className={classes.muted}>Updated {new Date(board.asOf).toLocaleTimeString()}</small>}
 </section>;
}

/** Existing CC0 samples; see public/audio/SOURCES.md. No synthesized audio. */
export function createAudio() {
 let muted=false;
 const active:HTMLAudioElement[]=[];
 function stop(){for(const audio of active){audio.pause();audio.currentTime=0;}active.length=0;}
 function play(name:'ui-click'|'blast'|'wood-impact',volume=1){
  if(muted||document.hidden)return;
  while(active.length>=5){active.shift()?.pause();}
  const audio=new Audio(`${import.meta.env.BASE_URL}audio/${name}.wav`);audio.volume=Math.max(0,Math.min(1,volume));
  active.push(audio);audio.addEventListener('ended',()=>{const index=active.indexOf(audio);if(index>=0)active.splice(index,1);},{once:true});
  void audio.play().catch(()=>{const index=active.indexOf(audio);if(index>=0)active.splice(index,1);});
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 return {play,setMuted(value:boolean){muted=value;if(muted)stop();},stop};
}

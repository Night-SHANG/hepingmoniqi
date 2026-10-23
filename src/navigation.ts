/** Presentation-only routing. A protected departure cannot complete before settlement. */
export type GameMode = 'main' | 'free';
export type GameScreen = 'home' | 'setup' | 'playing' | 'results';
type Destination = { screen:GameScreen; mode:GameMode };
export function createNavigation(){
 let screen:GameScreen='home', mode:GameMode='main', pending:Destination|null=null, waiting=false;
 return {
  request(next:GameScreen,nextMode:GameMode,protectedRound:boolean){
   if(waiting)return false;
   if(protectedRound){pending={screen:next,mode:nextMode};return false;}
   screen=next;mode=nextMode;pending=null;return true;
  },
  cancel(){if(!waiting)pending=null;},
  confirmFinish(){if(!pending)return false;waiting=true;return true;},
  settle(){if(pending){screen=pending.screen;mode=pending.mode;}pending=null;waiting=false;},
  get snapshot(){return {screen,mode,pending:pending?{...pending}:null,waiting};},
 };
}

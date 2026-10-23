// Production drag/render/price-validation bodies, with inert MT5 boundaries.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../mt5/'+name,import.meta.url),'utf8');
const drag=read('RRTargetDrag.mqh'),core=read('RRCore.mqh'),plans=read('RRPlan.mqh'),lines=read('RRTargetLines.mqh');
const manager=read('Position Sizer RR.mqh'),entry=read('Position Sizer RR.mq5');
const clone=structuredClone;
function extract(source,name){
 const m=new RegExp('(?:void|bool|double|int|uint|long)\\s+'+name+'\\(([^)]*)\\)\\s*\\{').exec(source);assert.ok(m,name);
 const start=m.index+m[0].length;let end=start,depth=1;
 for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 const args=m[1].split(',').filter(a=>a.trim()).map(a=>a.trim().replace(/^(?:const\s+)?\w+\s+&?/,''));
 let b=source.slice(start,end-1)
  .replace(/RRDragSnapshot (\w+) = ([^;]+);/g,'let $1 = clone($2);')
  .replace(/(?:RRDragSnapshot|RRState|RRPlan|MqlTick) (\w+);/g,'let $1 = {};')
  .replace('double remaining, server_tp;','let remaining, server_tp;')
  .replace(/\b(?:const\s+)?(?:string|long|ulong|uint|int|double|bool|datetime)\s+(?=\w+\s*(?:=|;))/g,'let ')
  .replace(/\((?:int|uint|long|ulong)\)/g,'');
 const refs=m[1].split(',').map(a=>a.trim()).filter(a=>/^(double|int|ulong|bool|string)\s+&/.test(a)).map(a=>a.match(/&(\w+)/)[1]);
 for(const ref of refs)b=b.replace(new RegExp('(?<![.\\w])'+ref+'\\b','g'),ref+'.value');
 b=b.replace('RRDragLines[slot] = item;','RRDragLines[slot] = clone(item);')
  .replace('RRDragLines[kept] = RRDragLines[i];','RRDragLines[kept] = clone(RRDragLines[i]);')
  .replace('RRTargetMultipleFromPrice(state.direction, state.entry, state.risk, requested, tick, digits, multiple, legal_price.value)',
   'RRTargetMultipleFromPrice(state.direction, state.entry, state.risk, requested, tick, digits, {get value(){return multiple;},set value(v){multiple=v;}}, legal_price)')
  .replace('RRPlanValidate(plan, error.value)','RRPlanValidate(plan, error)')
  .replace('RBReadManagedGroup(item.owner, current, symbol, remaining, server_tp, error.value)',
   'RBReadManagedGroup(item.owner,current,v=>{symbol=v.symbol;remaining=v.remaining;server_tp=v.tp;},error)')
  .replace('RRReadManagedPosition(item.symbol, item.magic, item.owner, current, ticket, error.value)',
   'RRReadManagedPosition(item.symbol,item.magic,item.owner,current,null,error)')
  .replace('RRPlanAtDraggedPrice(current, item.index, requested, item.symbol, updated, legal_price.value, error.value)',
   'RRPlanAtDraggedPrice(current,item.index,requested,item.symbol,updated,legal_price,error)')
  .replaceAll('item.plan_checksum, item.stage, error.value)','item.plan_checksum, item.stage, error)')
  .replace('RRSaveDraggedTarget(item, requested, legal_price, message.value)',
   'RRSaveDraggedTarget(item,requested,{get value(){return legal_price;},set value(v){legal_price=v;}},message)');
 if(name==='RRPlanChecksum')b=b.replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;', 'hash = Math.imul(hash ^ StringGetCharacter(value, i),16777619) >>> 0;');
 return `function ${name}(${args.join(',')}){${b}}`;
}
function makeState(){return {version:2,identifier:42,magic:123,stage:0,pending:0,blocked:0,direction:1,entry:100,risk:3,
 target_count:3,target_r:[2,3,5],target_percent:[50,25,25],target_be:[1,0,0]};}
function fixture(){
 const c={RRDragLines:[],RRDragFocusedOwner:0,RRDragFocusedParent:false,RR_Enable:true,_Symbol:'TEST',_Period:5,RR_MAX_TARGETS:20,account:11,server:'Demo',
  tick:.01,digits:2,quote:{bid:101,ask:101.02},state:makeState(),groups:new Map(),objects:new Map(),calls:[],
  ArraySize:a=>a.length,ArrayResize:(a,n)=>{a.length=n;},clone,
  MathIsValidNumber:Number.isFinite,MathAbs:Math.abs,MathRound:Math.round,MathCeil:Math.ceil,MathFloor:Math.floor,
  MathMax:Math.max,MathMin:Math.min,NormalizeDouble:(v,d)=>Number(v.toFixed(d)),
  StringFind:(v,s)=>v.indexOf(s),StringLen:v=>v.length,StringGetCharacter:(v,i)=>v.charCodeAt(i),
  IntegerToString:String,DoubleToString:(v,d)=>Number(v).toFixed(d),
  StringFormat:(fmt,...args)=>fmt+' '+args.join(' '),
  ChartID:()=>1,AccountInfoInteger:()=>c.account,AccountInfoString:()=>c.server,
  SymbolInfoDouble:()=>c.tick,SymbolInfoInteger:()=>c.digits,TerminalInfoInteger:()=>c.connected!==false,
  SymbolInfoTick:(_,out)=>{Object.assign(out,c.quote);return true;},
  ObjectFind:(_,n)=>c.objects.has(n)?0:-1,ObjectCreate:(_,n,type,sub,time,price)=>{c.objects.set(n,{OBJPROP_TYPE:type,OBJPROP_PRICE:price,OBJPROP_SELECTED:false});return true;},
  ObjectGetInteger:(_,n,k)=>c.objects.get(n)?.[k]??0,ObjectGetDouble:(_,n,k)=>c.objects.get(n)?.[k]??0,
  ObjectSetInteger:(_,n,k,v)=>{c.objects.get(n)[k]=v;return true;},
  ObjectSetDouble:(_,n,k,v)=>{c.objects.get(n)[k]=v;return true;},
  ObjectSetString:(_,n,k,v)=>{c.objects.get(n)[k]=v;return true;},
  ChartGetInteger:()=>650,iTime:()=>0,RRPlaceTargetLabel:v=>v,
  RBIsChild:()=>c.child||false,RBGroupBuilding:id=>c.groups.get(id)?.building||false,
  RRStatePlan:(s,p)=>Object.assign(p,{count:s.target_count,targets:s.target_r.map((multiple,i)=>({multiple,percent:s.target_percent[i],move_be:s.target_be[i]}))}),
  RRReadManagedPosition:(symbol,magic,id,s,ticket,error)=>{if(c.readFail||id!==c.state.identifier||symbol!==c._Symbol||magic!==c.state.magic){error.value='读取失败';return false;}Object.assign(s,clone(c.state));return true;},
  RBReadManagedGroup:(id,s,output,error)=>{const g=c.groups.get(id);if(!g){error.value='父组不存在';return false;}Object.assign(s,clone(g.state));output(g);return true;},
 };
 const constants=['ACCOUNT_LOGIN','ACCOUNT_SERVER','SYMBOL_TRADE_TICK_SIZE','SYMBOL_DIGITS','TERMINAL_CONNECTED','OBJ_HLINE','OBJ_LABEL','OBJPROP_TYPE','OBJPROP_PRICE','OBJPROP_SELECTED','OBJPROP_SELECTABLE','OBJPROP_COLOR','OBJPROP_STYLE','OBJPROP_WIDTH','OBJPROP_HIDDEN','OBJPROP_BACK','OBJPROP_TEXT','OBJPROP_TOOLTIP','OBJPROP_ZORDER','STYLE_DOT','STYLE_DASH','CHART_HEIGHT_IN_PIXELS'];
 for(const k of constants)c[k]=k;
 c.RRApplyPositionPlan=(symbol,magic,id,p,hash,stage,error)=>{
  c.calls.push({parent:false,symbol,magic,id,plan:clone(p),hash,stage});
  if(c.failSave||c.race){error.value='未保存';return false;}
  if(!c.RRPositionPlanPricesSafe(c.state,p,symbol,error))return false;
  c.state.target_r=p.targets.map(t=>t.multiple);return true;
 };
 c.RBApplyGroupPlan=(id,p,hash,stage,error)=>{
  c.calls.push({parent:true,id,plan:clone(p),hash,stage});
  if(c.failSave){error.value='未保存';return false;}
  const g=c.groups.get(id);if(!c.RRPositionPlanPricesSafe(g.state,p,g.symbol,error))return false;
  g.state.target_r=p.targets.map(t=>t.multiple);return true;
 };
 vm.createContext(c);
 for(const name of ['RRTargetPrice','RRTargetReached','RRTargetMultipleFromPrice'])vm.runInContext(extract(core,name),c);
 for(const name of ['RRPlanValidate','RRPlanChecksum'])vm.runInContext(extract(plans,name),c);
 vm.runInContext(extract(manager,'RRPositionPlanPricesSafe'),c);
 for(const name of ['RRFindDragLine','RRFocusTargetLines','RRTargetLinePriority','RRTargetLineEditing','RRResetDragLines','RRPruneDragLines','RRRememberTargetLine','RRPlanAtDraggedPrice','RRSaveDraggedTarget','RRHandleTargetDrag'])vm.runInContext(extract(drag,name),c);
 vm.runInContext(extract(lines,'RRDrawTarget'),c);
 c.remember=(index=0,parent=false,id=42,editable=true)=>{
  const s=parent?c.groups.get(id).state:c.state,p={};c.RRStatePlan(s,p);
  const key='PSRR_Targets_'+(parent?'Parent_':'')+id+'_'+index;
  const price=c.RRTargetPrice(s.direction,s.entry,s.risk,s.target_r[index],c.tick,c.digits);
  c.RRRememberTargetLine(key+'_Line','TEST',id,parent,s,p,index,price,editable);
  c.RRDrawTarget(key,price,'saved target','gold',false,index,editable);return key+'_Line';
 };
 c.drop=(name,price)=>{c.objects.get(name).OBJPROP_PRICE=price;const message={value:''},owner={value:0},parent={value:false},saved={value:false};
  const handled=c.RRHandleTargetDrag(name,message,owner,parent,saved);return {handled,message:message.value,owner:owner.value,parent:parent.value,saved:saved.value};};
 return c;
}
let count=0;function check(name,fn){fn();console.log('PASS '+name);count++;}
check('buy target drag saves exact tick price and preserves other stages, percent and BE',()=>{
 const c=fixture(),name=c.remember(),before=clone(c.state);const r=c.drop(name,107.13);
 assert.equal(r.saved,true);assert.equal(c.calls.length,1);assert.equal(c.calls[0].id,42);
 assert.equal(c.state.target_r[0],(107.13-100)/3);assert.deepEqual(c.state.target_r.slice(1),before.target_r.slice(1));
 assert.deepEqual(c.calls[0].plan.targets.map(t=>t.percent),[50,25,25]);assert.deepEqual(c.calls[0].plan.targets.map(t=>t.move_be),[1,0,0]);
 assert.equal(c.objects.get(name).OBJPROP_PRICE,107.13);assert.equal(c.objects.get(name).OBJPROP_SELECTED,false);
});
check('sell drag uses frozen opening price and returns legal target without changing SL or volume',()=>{
 const c=fixture();c.state.direction=-1;c.quote={bid:98.98,ask:99};const name=c.remember();assert.equal(c.drop(name,92.87).saved,true);
 assert.equal(c.state.target_r[0],(100-92.87)/3);assert.equal(c.state.entry,100);assert.equal(c.state.risk,3);
});
check('fractional tick drop snaps to nearest legal exchange price',()=>{
 const c=fixture();c.tick=.25;const name=c.remember();assert.equal(c.drop(name,107.14).saved,true);assert.equal(c.objects.get(name).OBJPROP_PRICE,107.25);
});
check('parent drop calls only group API and keeps every other parent unchanged',()=>{
 const c=fixture();c.groups.set(9001,{state:makeState(),symbol:'TEST',remaining:40,tp:115});c.groups.set(9002,{state:makeState(),symbol:'TEST',remaining:5,tp:115});
 const name=c.remember(0,true,9001);assert.equal(c.drop(name,107.13).saved,true);assert.equal(c.calls[0].parent,true);assert.equal(c.calls[0].id,9001);assert.equal(c.groups.get(9002).state.target_r[0],2);
});
check('another position line edits that identifier only even when entry Magic differs',()=>{
 const c=fixture();c.state.identifier=77;c.state.magic=999;const name=c.remember(0,false,77);assert.equal(c.drop(name,107.13).saved,true);
 assert.equal(c.calls[0].id,77);assert.equal(c.calls[0].magic,999);
});
check('timer redraw leaves selected line price and its original generation untouched',()=>{
 const c=fixture(),name=c.remember();const first=clone(c.RRDragLines[0]);c.objects.get(name).OBJPROP_SELECTED=true;c.objects.get(name).OBJPROP_PRICE=107.13;
 c.state.target_r[0]=2.4;c.remember();assert.equal(c.objects.get(name).OBJPROP_PRICE,107.13);assert.deepEqual({...c.RRDragLines[0],editing:false},first);assert.equal(c.RRDragLines[0].editing,true);
 const r=c.drop(name,107.13);assert.equal(r.saved,false);assert.match(r.message,/变化/);assert.equal(c.calls.length,0);assert.equal(c.objects.get(name).OBJPROP_PRICE,106);
});
check('ordinary redraw updates deselected line and snapshot to confirmed plan',()=>{
 const c=fixture(),name=c.remember();c.state.target_r[0]=2.4;c.remember();assert.equal(c.objects.get(name).OBJPROP_PRICE,107.2);assert.equal(c.RRDragLines[0].price,107.2);
});
check('properties price edit survives timer before CHANGE even without selection',()=>{
 const c=fixture(),name=c.remember();c.objects.get(name).OBJPROP_PRICE=107.13;c.remember();
 assert.equal(c.objects.get(name).OBJPROP_PRICE,107.13);assert.equal(c.RRDragLines[0].price,106);assert.equal(c.RRDragLines[0].editing,true);
 assert.equal(c.drop(name,107.13).saved,true);c.remember();assert.equal(c.RRDragLines[0].editing,false);assert.equal(c.objects.get(name).OBJPROP_PRICE,107.13);
});
check('overlapping lines prioritize selected position and distinguish parent with same ID',()=>{
 const c=fixture(),name=c.remember();c.groups.set(42,{state:makeState(),symbol:'TEST',remaining:5,tp:115});const group=c.remember(0,true,42);
 c.RRFocusTargetLines(42,false);
 assert.equal(c.objects.get(name).OBJPROP_ZORDER,20);assert.equal(c.objects.get(group).OBJPROP_ZORDER,10);
 c.RRFocusTargetLines(42,true);
 assert.equal(c.objects.get(name).OBJPROP_ZORDER,10);assert.equal(c.objects.get(group).OBJPROP_ZORDER,20);
 assert.equal(c.objects.get(name).OBJPROP_HIDDEN,false);assert.equal(c.objects.get(group).OBJPROP_BACK,false);
});
check('unchanged selected owner performs no native reads or writes, including after line creation',()=>{
 const c=fixture(),name=c.remember();c.RRFocusTargetLines(42,false);
 const find=c.ObjectFind,write=c.ObjectSetInteger;
 c.ObjectFind=()=>{throw Error('unchanged focus must not synchronously probe lines');};
 c.ObjectSetInteger=()=>{throw Error('unchanged focus must not rewrite lines');};
 for(let i=0;i<1000;i++)c.RRFocusTargetLines(42,false);
 c.ObjectFind=find;c.ObjectSetInteger=write;
 const second=c.remember(1);assert.equal(c.objects.get(second).OBJPROP_ZORDER,20);
 c.objects.delete(name);c.RRPruneDragLines();const recreated=c.remember();
 assert.equal(c.objects.get(recreated).OBJPROP_ZORDER,20);
});
check('selection or color-only property changes do not persist a new plan',()=>{
 const c=fixture(),name=c.remember();c.objects.get(name).OBJPROP_SELECTED=true;c.remember();
 const r=c.drop(name,106);assert.equal(r.owner,0);assert.equal(r.saved,false);assert.equal(r.message,'');assert.equal(c.calls.length,0);
 assert.equal(c.objects.get(name).OBJPROP_SELECTED,false);assert.equal(c.RRDragLines[0].editing,false);
});
check('triggered line becomes unselectable even if previously selected',()=>{
 const c=fixture(),name=c.remember();c.objects.get(name).OBJPROP_SELECTED=true;c.objects.get(name).OBJPROP_PRICE=107;
 c.state.stage=1;c.remember(0,false,42,false);assert.equal(c.objects.get(name).OBJPROP_SELECTED,false);assert.equal(c.objects.get(name).OBJPROP_SELECTABLE,false);
 assert.equal(c.drop(name,107).saved,false);assert.equal(c.calls.length,0);
});
for(const field of ['blocked','pending'])check(field+' state rejects a drop without writing',()=>{
 const c=fixture(),name=c.remember();c.state[field]=1;assert.equal(c.drop(name,107).saved,false);assert.equal(c.calls.length,0);
});
check('stage change while dragging rejects rather than editing a newly active stage',()=>{
 const c=fixture(),name=c.remember(1);c.state.stage=1;assert.equal(c.drop(name,110).saved,false);assert.equal(c.calls.length,0);
});
check('parent still building cannot move group target',()=>{
 const c=fixture();c.groups.set(9,{state:makeState(),symbol:'TEST',remaining:5,building:true});const name=c.remember(0,true,9);assert.equal(c.drop(name,107).saved,false);assert.equal(c.calls.length,0);
});
check('child with an obsolete ordinary journal cannot be independently edited',()=>{
 const c=fixture(),name=c.remember();c.child=true;assert.equal(c.drop(name,107).saved,false);assert.equal(c.calls.length,0);
});
for(const mutate of [c=>c.account++,c=>c.server='Other',c=>c._Symbol='OTHER',c=>c.RR_Enable=false])check('account, server, symbol or disabled manager invalidates drag authority',()=>{
 const c=fixture(),name=c.remember();mutate(c);assert.equal(c.drop(name,107).saved,false);assert.equal(c.calls.length,0);
});
check('crossing or overlapping adjacent TP is rejected without changing another target',()=>{
 for(const price of [106,105,115,116]){const c=fixture(),name=c.remember(1),before=clone(c.state);assert.equal(c.drop(name,price).saved,false);assert.deepEqual(c.state,before);assert.equal(c.calls.length,0);}
});
check('profit-side, NaN and invalid price drops are rejected and line is restored',()=>{
 for(const price of [100,99,0,-1,NaN,Infinity]){const c=fixture(),name=c.remember();assert.equal(c.drop(name,price).saved,false);assert.equal(c.calls.length,0);assert.equal(c.objects.get(name).OBJPROP_PRICE,106);}
});
check('old target reaching quote during drag cannot be moved away from its obligation',()=>{
 const c=fixture(),name=c.remember();c.quote={bid:106,ask:106.02};const r=c.drop(name,107);assert.equal(r.saved,false);assert.match(r.message,/刚刚到价/);assert.equal(c.state.target_r[0],2);
});
check('a newly dragged target already reached by quote is rejected',()=>{
 const c=fixture(),name=c.remember();c.quote={bid:105,ask:105.02};assert.equal(c.drop(name,104).saved,false);assert.equal(c.state.target_r[0],2);
});
check('disconnected quote validation rejects persistence',()=>{
 const c=fixture(),name=c.remember();c.connected=false;assert.equal(c.drop(name,107).saved,false);assert.equal(c.state.target_r[0],2);
});
for(const field of ['readFail','failSave','race'])check(field+' restores the previously saved visible price',()=>{
 const c=fixture(),name=c.remember();c[field]=true;assert.equal(c.drop(name,107).saved,false);assert.equal(c.objects.get(name).OBJPROP_PRICE,106);assert.equal(c.state.target_r[0],2);
});
check('preview, unknown names and removed objects never authorize writes',()=>{
 const c=fixture();for(const name of ['user_line','PSRR_Targets_Preview_0_Line','PSRR_Targets_999_0_Line']){
 const m={value:''},id={value:0},p={value:false},s={value:false};c.RRHandleTargetDrag(name,m,id,p,s);assert.equal(s.value,false);assert.equal(id.value,0);}
 const name=c.remember();c.objects.delete(name);c.RRPruneDragLines();assert.equal(c.RRDragLines.length,0);assert.equal(c.calls.length,0);
});
check('reset removes every stale drag snapshot',()=>{const c=fixture();c.remember();c.RRResetDragLines();assert.equal(c.RRDragLines.length,0);});
check('entry routes drag and properties edits before the legacy calculator event branch',()=>{
 const from=entry.indexOf('void OnChartEvent('),body=entry.slice(from,entry.indexOf('void OnTimer()',from));
 assert.match(body,/id == CHARTEVENT_OBJECT_DRAG \|\| id == CHARTEVENT_OBJECT_CHANGE/);
 assert.ok(body.indexOf('RRHandleTargetDrag')<body.indexOf('if (id == CHARTEVENT_MOUSE_MOVE)'));
 assert.match(body,/NotifyRRTargetMoved/);assert.match(body,/RRRefreshViews\(true\)/);
 assert.doesNotMatch(drag,/\b(?:OrderSend|OrderCheck|PositionClose)\s*\(/);
});
console.log(`${count} target drag checks passed.`);

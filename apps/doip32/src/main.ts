import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Doip32Session } from "./Doip32Session.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let session: Doip32Session | undefined;
function createWindow() { const win = new BrowserWindow({ width:1180,height:760,minWidth:900,minHeight:600,title:"DoIP32",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false}}); void win.loadFile(path.join(__dirname,"../ui/index.html")); }
ipcMain.handle("pick-ecu-path",async()=>{const r=await dialog.showOpenDialog({properties:["openDirectory"],title:"EDIABAS ECU / PRG-Verzeichnis auswählen"});return r.canceled?undefined:r.filePaths[0]});
ipcMain.handle("pick-sgbd",async()=>{const r=await dialog.showOpenDialog({properties:["openFile"],filters:[{name:"BMW SGBD",extensions:["prg","grp"]}]});return r.canceled?undefined:r.filePaths[0]});
ipcMain.handle("open-sgbd",async(_e,cfg)=>{if(session)await session.disconnect().catch(()=>undefined);session=new Doip32Session({ecuPath:cfg.ecuPath,host:cfg.host,port:Number(cfg.port||6801),onTrace:(direction,data)=>_e.sender.send("wire-trace",{direction,hex:Array.from(data,b=>b.toString(16).padStart(2,"0")).join(" ").toUpperCase(),time:new Date().toLocaleTimeString()})});return await session.openSgbd(cfg.sgbd)});
ipcMain.handle("connect",async()=>{if(!session)throw new Error("Zuerst PRG/GRP laden");await session.connect();return true});
ipcMain.handle("disconnect",async()=>{await session?.disconnect();return true});
ipcMain.handle("run-job",async(_e,job:string,params:string[])=>{if(!session)throw new Error("Zuerst PRG/GRP laden");return await session.run(job,params)});
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});

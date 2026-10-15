import { installRendererDiagnosticBoundary, rendererFailure } from '../shared/diagnostics.mjs';
import { renderDocument } from '../../document/files.mjs';

installRendererDiagnosticBoundary();
const {json,...options}=JSON.parse(process.argv[6]||'{}');
try{
  const result=await renderDocument({inputPath:process.argv[2],outputPath:process.argv[3]||undefined,designPath:process.argv[4]||undefined,designOptionsPath:process.argv[5]||undefined,...options});
  if(json)console.log(JSON.stringify(result));
}catch(error){
  if(!json)throw error;
  console.log(JSON.stringify(rendererFailure(error)));
  process.exitCode=1;
}

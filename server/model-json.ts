export class ModelJsonError extends Error {
  constructor(public readonly content:string, public readonly detail:string, public readonly metadata:Record<string,unknown>={}) {
    super(detail);
    this.name='ModelJsonError';
  }
}

// Remove only a dangling, empty property with no colon or value at the end of
// an object. Never modify strings, named properties, values or missing braces.
function removeEmptyProperty(text:string){
  let output='',inString=false,escaped=false,count=0;
  const stack:string[]=[];
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(!inString&&char===','&&stack.at(-1)==='{'){
      const match=text.slice(i).match(/^,\s*""\s*(?=})/);
      if(match){i+=match[0].length-1;count++;continue;}
    }
    output+=char;
    if(inString){
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char==='"')inString=false;
    }else if(char==='"')inString=true;
    else if(char==='{'||char==='[')stack.push(char);
    else if(char==='}'||char===']')stack.pop();
  }
  return {output,count};
}

export function parseModelJson(content:unknown,metadata:Record<string,unknown>={}){
  if(typeof content!=='string'||!content.trim())throw new ModelJsonError('','JSON: 接口未返回正文内容',{...metadata,failure:'empty'});
  const text=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let output:unknown;
  const adjustments:string[]=[];
  try{output=JSON.parse(text);}catch(error){
    const repaired=removeEmptyProperty(text);
    let repairedSuccessfully=false;
    if(repaired.count){
      try{output=JSON.parse(repaired.output);repairedSuccessfully=true;adjustments.push(`JSON: 移除 ${repaired.count} 个对象末尾无值的空字段`);}catch{}
    }
    if(!repairedSuccessfully){
      const positionText=(error as Error).message.match(/position (\d+)/)?.[1];
      const position=positionText===undefined?undefined:Number(positionText);
      const location=position===undefined?'':`（第 ${text.slice(0,position).split('\n').length} 行，字符位置 ${position}）`;
      throw new ModelJsonError(content,`JSON: 语法错误${location}`,{...metadata,failure:'syntax',position,contentCharacters:content.length});
    }
  }
  if(output===null||typeof output!=='object'||Array.isArray(output))throw new ModelJsonError(content,'JSON: 顶层必须是对象，不能是数组、字符串或空值',{...metadata,failure:'non_object'});
  return {output,adjustments};
}


// Identity-review responses occasionally use a bare decision array despite
// JSON-object mode. Wrap only that exact JSON form; never repair its facts.
export function parseIdentityReviewJson(content:unknown,metadata:Record<string,unknown>={}){
  try{return parseModelJson(content,metadata);}catch(error){
    if(!(error instanceof ModelJsonError)||error.metadata.failure!=='non_object')throw error;
    const text=error.content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const value:unknown=JSON.parse(text);
    if(!Array.isArray(value))throw error;
    return {output:{decisions:value},adjustments:['JSON: 将身份决策数组包装为 decisions 对象']};
  }
}

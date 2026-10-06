export function calculate(expression:string):number{
  const tokens=expression.match(/\d*\.?\d+(?:e[+-]?\d+)?|[()+\-*/%^]/gi)??[];
  if(tokens.join('')!==expression.replace(/\s/g,'')||!tokens.length)throw new Error('无效表达式');let index=0;
  const atom=():number=>{const t=tokens[index++];if(t==='+')return atom();if(t==='-')return -atom();if(t==='('){const value=sum();if(tokens[index++]!==')')throw new Error('括号不匹配');return value;}const value=Number(t);if(!Number.isFinite(value))throw new Error('无效数字');return value;};
  const power=():number=>{const value=atom();return tokens[index]==='^'?(index++,value**power()):value;};
  const product=():number=>{let value=power();while(['*','/','%'].includes(tokens[index])){const op=tokens[index++],right=power();value=op==='*'?value*right:op==='/'?value/right:value%right;}return value;};
  const sum=():number=>{let value=product();while(['+','-'].includes(tokens[index])){const op=tokens[index++],right=product();value=op==='+'?value+right:value-right;}return value;};
  const value=sum();if(index!==tokens.length||!Number.isFinite(value))throw new Error('无法计算');return value;
}

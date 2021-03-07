import Plugin from                      '@vvvictorlee2020/core/plugins/Plugin';
import * as PluginTypes from            '@vvvictorlee2020/core/plugins/PluginTypes';
import * as Actions from                '@vvvictorlee2020/core/models/api/ApiActions';
import {Blockchains} from               '@vvvictorlee2020/core/models/Blockchains'
import Network from                     '@vvvictorlee2020/core/models/Network'
import KeyPairService from              '@vvvictorlee2020/core/services/secure/KeyPairService';
import Token from                       "@vvvictorlee2020/core/models/Token";
import HardwareService from             "@vvvictorlee2020/core/services/secure/HardwareService";
import StoreService from                "@vvvictorlee2020/core/services/utility/StoreService";
import TokenService from                "@vvvictorlee2020/core/services/utility/TokenService";
import EventService from                "@vvvictorlee2020/core/services/utility/EventService";
import SigningService from              "@vvvictorlee2020/core/services/secure/SigningService";

import TronWeb from 'tronweb';
const ethUtil = require('ethereumjs-util');
const toBuffer = key => ethUtil.toBuffer(ethUtil.addHexPrefix(key));
const trc20abi = require('./trc20');

let utils;
// const utils = tronWeb.utils;

let cachedInstances = {};
const getCachedInstance = network => {
	if(cachedInstances.hasOwnProperty(network.unique())) return cachedInstances[network.unique()];
	else {
		const provider = new TronWeb.providers.HttpProvider(network.fullhost());
		const tronWeb = new TronWeb(provider, provider, network.fullhost());
		cachedInstances[network.unique()] = tronWeb;
		return tronWeb;
	}
}

const EXPLORER = {
	"name":"Tronscan",
	"account":"https://tronscan.org/#/address/{x}",
	"transaction":"https://tronscan.org/#/transaction/{x}",
	"block":"https://tronscan.org/#/block/{x}"
};

export default class TRX extends Plugin {

	constructor(){ super(Blockchains.TRX, PluginTypes.BLOCKCHAIN_SUPPORT) }

	init(){
		const DUMMY_NET = 'https://api.shasta.trongrid.io'
		const provider = new TronWeb.providers.HttpProvider(DUMMY_NET);
		const tronWeb = new TronWeb(provider, provider, DUMMY_NET);
		utils = tronWeb.utils;
	}

	bip(){ return `44'/195'/0'/0/`}
	bustCache(){ cachedInstances = {}; }
	defaultExplorer(){ return EXPLORER; }
	accountFormatter(account){ return `${account.publicKey}` }
	returnableAccount(account){ return { address:account.publicKey, blockchain:Blockchains.TRX }}

	contractPlaceholder(){ return '0x.....'; }

	checkNetwork(network){
		return Promise.race([
			new Promise(resolve => setTimeout(() => resolve(null), 2000)),
			//TODO:
			new Promise(resolve => setTimeout(() => resolve(true), 10)),
		])
	}

	getEndorsedNetwork(){
		return new Network('Tron Mainnet', 'https', 'api.trongrid.io', 443, Blockchains.TRX, '1');
	}

	isEndorsedNetwork(network){
		const endorsedNetwork = this.getEndorsedNetwork();
		return network.blockchain === Blockchains.TRX && network.chainId === endorsedNetwork.chainId;
	}

	async getChainId(network){
		return 1;
	}

	usesResources(){ return false; }
	hasAccountActions(){ return false; }

	accountsAreImported(){ return false; }
	isValidRecipient(address){ return utils.crypto.isAddressValid(address); }
	privateToPublic(privateKey){
		if(typeof privateKey === 'string') privateKey = this.hexPrivateToBuffer(privateKey);
		return utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey(privateKey));
	}
	validPrivateKey(privateKey){ return privateKey.length === 64 && ethUtil.isValidPrivate(toBuffer(privateKey)); }
	validPublicKey(address){ return utils.crypto.isAddressValid(address); }
	bufferToHexPrivate(buffer){ return new Buffer(buffer).toString('hex') }
	hexPrivateToBuffer(privateKey){ return Buffer.from(privateKey, 'hex'); }

	bufferToHexPublicKeyOrAddress(buffer){
		const ec = new (require('elliptic').ec)('secp256k1');
		const pubkey = ec.keyFromPublic(buffer).getPublic();
		let xHex = pubkey.x.toString('hex');
		while (xHex.length < 64) xHex = `0${xHex}`;
		let yHex = pubkey.y.toString('hex');
		while (yHex.length < 64) yHex = `0${yHex}`;
		const pubkeyBytes = Buffer.from(`04${xHex}${yHex}`, 'hex');
		return utils.crypto.getBase58CheckAddress(utils.crypto.computeAddress(pubkeyBytes))
	}


	hasUntouchableTokens(){ return false; }

	async balanceFor(account, token){
		const tron = getCachedInstance(account.network());
		const clone = token.clone();
		if(token.uniqueWithChain() === this.defaultToken().uniqueWithChain()){
			const bal = await tron.trx.getBalance(account.publicKey);
			clone.amount = tron.toBigNumber(bal).div(1000000).toFixed(6).toString(10);
		} else {
			let balance;
			try {
				tron.setAddress(account.publicKey);
				const contract = await tron.contract(trc20abi).at(token.contract);
				clone.amount = TokenService.formatAmount(await contract.balanceOf(account.publicKey).call(), token, true);
			} catch(e){
				console.error(`${token.name} is not an ERC20 token`, e);
				clone.amount = parseFloat(0).toFixed(token.decimals);
			}
		}

		return clone;
	}

	async balancesFor(account, tokens){
		const tron = getCachedInstance(account.network());
		const formatBalance = n => tron.toBigNumber(n).div(1000000).toFixed(6).toString(10);

		const trx = this.defaultToken();
		const {asset, balance, assetV2} = await Promise.race([
			new Promise(resolve => setTimeout(() => resolve({asset:[], balance:0}), 2000)),
			tron.trx.getAccount(account.sendable()).catch(() => ({asset:[], balance:0}))
		]);
		trx.amount = formatBalance(balance);

		let altTokens = [];

		if(assetV2){
			await Promise.all(assetV2.map(async ({key, value}) => {
				const token = await tron.trx.getTokenByID(key);
				altTokens.push(Token.fromJson({
					key,
					blockchain:Blockchains.TRX,
					contract:'',
					symbol:token.abbr,
					name:token.name,
					decimals:this.defaultDecimals(),
					amount:formatBalance(value),
					chainId:account.network().chainId,
				}));
				return true;
			}));
		}

		// This doesn't work with sendToken now!
		// if(asset){
		// 	altTokens = asset.map(({key:symbol, value}) => {
		// 		return Token.fromJson({
		// 			blockchain:Blockchains.TRX,
		// 			contract:'',
		// 			symbol,
		// 			name:symbol,
		// 			decimals:this.defaultDecimals(),
		// 			amount:formatBalance(value),
		// 			chainId:account.network().chainId,
		// 		})
		// 	})
		// }

		for(let i = 0; i < tokens.length; i++){
			altTokens.push(await this.balanceFor(account, tokens[i]));
		}

		return [trx].concat(altTokens);
	}

	defaultDecimals(){ return 6; }
	defaultToken(){ return new Token(Blockchains.TRX, 'trx', 'TRX', 'TRX', this.defaultDecimals(), '1') }
	actionParticipants(payload){ return payload.transaction.participants }


	async transfer({account, to, amount, token, promptForSignature = true}){
		amount = TokenService.formatAmount(amount, token);
		return new Promise(async (resolve, reject) => {
			const tron = getCachedInstance(account.network());

			const isTRX = token.unique() === this.defaultToken().unique();
			const isTRC10 = !isTRX && !token.contract || !token.contract.length;
			const isTRC20 = !isTRX && !isTRC10;

			let abi = null;
			tron.trx.sign = async signargs => {
				const transaction = { transaction:signargs, participants:[account.publicKey], };
				const payload = { transaction, blockchain:Blockchains.TRX, network:account.network(), requiredFields:{}, abi };
				return promptForSignature
					? await this.signerWithPopup(payload, account, reject)
					: await SigningService.sign(account.network(), payload, account.publicKey, false, false);
			};

			let unsignedTransaction;

			// SENDING TRX
			if(isTRX) {
				unsignedTransaction = await tron.transactionBuilder.sendTrx(to, amount, account.publicKey).catch(error => {
					return resolve({error});
				});
			}

			// Sending built-in alt token
			else if (isTRC10){
				tron.setAddress(account.sendable());
				unsignedTransaction = await tron.transactionBuilder.sendToken(to, amount, token.key ? token.key : token.symbol).catch(error => {
					return resolve({error});
				});
			}

			// Sending TRC20 alt token
			else if (isTRC20) {
				abi = {
					abi:trc20abi,
					method:'transfer',
					token,
				};
				const contract = await tron.contract(trc20abi).at(token.contract);
				const {inputs, functionSelector, defaultOptions} = contract.methodInstances.transfer;
				defaultOptions.from = account.publicKey;
				const txData = await tron.transactionBuilder.triggerSmartContract(
					token.contract,
					functionSelector,
					defaultOptions,
					inputs.map(({name, type}) => {
						return {
							type,
							value:type === 'address' ? to : amount
						}
					}),
					tron.address.toHex(account.publicKey)
				).catch(err => {
					console.error(err);
					return null;
				});
				if(!txData) return resolve(null);
				unsignedTransaction = txData.transaction;
			}

			else {
				console.error('Not TRX, TRC10, or TRC20!')
				return resolve(null);
			}

			if(!unsignedTransaction) return;

			const signed = await tron.trx.sign(unsignedTransaction)
				.then(x => ({success: true, result: x}))
				.catch(error => ({success: false, result: error}));

			if (!signed.success) return resolve({error: signed.result});
			else {
				const sent = await tron.trx.sendRawTransaction(signed.result).then(x => x.result).catch(err => {
					console.error(err);
					return null;
				});
				resolve(sent ? signed.result : {error: 'Failed to send.'});
			}
		})
	}

	async signer(payload, publicKey, arbitrary = false, isHash = false, privateKey = null){

		if(!privateKey) privateKey = await KeyPairService.publicToPrivate(publicKey);
		if (!privateKey) return;

		if(typeof privateKey !== 'string') privateKey = this.bufferToHexPrivate(privateKey);

		return utils.crypto.signTransaction(privateKey, payload.transaction.transaction);
	}

	async signerWithPopup(payload, account, rejector){
		return new Promise(async resolve => {
			payload.messages = await this.requestParser(payload);
			payload.identityKey = StoreService.get().state.scatter.keychain.identities[0].publicKey;
			payload.participants = [account];
			payload.network = account.network();
			payload.origin = 'Scatter';
			const request = {
				payload,
				origin:payload.origin,
				blockchain:Blockchains.TRX,
				requiredFields:{},
				type:Actions.SIGN,
				id:1,
			}

			EventService.emit('popout', request).then( async ({result}) => {
				if(!result || (!result.accepted || false)) return rejector({error:'Could not get signature'});

				let signature = null;
				if(KeyPairService.isHardware(account.publicKey)){
					signature = await HardwareService.sign(account, payload);
				} else signature = await SigningService.sign(payload.network, payload, account.publicKey);

				if(!signature) return rejector({error:'Could not get signature'});

				resolve(signature);
			}, true);
		})
	}

	async requestParser(transaction, network, abiData){
		if(!abiData && transaction.abi) abiData = transaction.abi;

		network = Network.fromJson(transaction.network);
		const txID = transaction.transaction.transaction.txID;
		transaction = transaction.transaction.transaction.raw_data;

		const tron = getCachedInstance(network);
		return transaction.contract.map(contract => {

			let data = contract.parameter.value;
			const address = data.hasOwnProperty('contract_address') ? data.contract_address : 'system';
			const quantity = data.hasOwnProperty('call_value') ? {paying:tron.fromSun(data.call_value) + ' TRX'} : {};

			let params = {};
			let methodABI;
			if(abiData){
				const {abi, method, token} = abiData;
				methodABI = abi.find(x => x.name === method);
				if(!methodABI) throw Error.signatureError('no_abi_method', "No method signature on the abi you provided matched the data for this transaction");
				const names = methodABI.inputs.map(x => x.name);
				const types = methodABI.inputs.map(x => x.type);

				data = tron.utils.abi.decodeParams(names, types, data.data, true);
				data = Object.assign(data, quantity);

				if(token){
					data.token = token.symbol;
					data.value = TokenService.formatAmount(tron.toBigNumber(data.value).toString(), token, true);
				}

				Object.keys(data).map(key => {
					if(typeof data[key] === 'object' && data[key]._ethersType === 'BigNumber') data[key] = tron.toBigNumber(data[key]);
					if(tron.utils.isBigNumber(data[key])) data[key] = data[key].toString();
				});
			}


			return {
				data,
				code:address,
				type:methodABI ? methodABI.name : 'transfer',
			};

		})
	}

}

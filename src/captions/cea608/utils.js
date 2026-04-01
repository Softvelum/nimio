import { specialCea608CharsCodes } from './constants'

export class Utils {

  static numArrayToHexArray (numArray) {
    let hexArray = [];
    for (let j = 0; j < numArray.length; j++) {
      hexArray.push(numArray[j].toString(16));
    }

    return hexArray;
  }

  /**
   * Get Unicode Character from CEA-608 byte code
   */
  static getCharForByte (byte) {
    let charCode = byte;
    if (specialCea608CharsCodes.hasOwnProperty(byte)) {
      charCode = specialCea608CharsCodes[byte];
    }

    return String.fromCharCode(charCode);
  }

}

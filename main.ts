import fetch from "node-fetch";

const apiKey = "test-Z9EB05N-07FMA5B-PYFEE46-X4ECYAR"
const meterId = "6514167223e3d1424bf82742"

fetchAllData()
    .then(makeCalculations)
    .catch(console.error)

function fetchAllData() {
    const consumptionDataUrl = `https://api.openvolt.com/v1/interval-data?meter_id=${meterId}&granularity=hh&start_date=2023-01-01&end_date=2023-01-31`
    const consumptionDataOptions = { headers: { accept: 'application/json', 'x-api-key': apiKey } }
    const consumptionDataPromise = fetch(consumptionDataUrl, consumptionDataOptions).then(res =>
        res.status == 200
            ? <Promise<ConsumptionData>>res.json().catch(err => Promise.reject("Failed to parse consumption data: " + err))
            : res.text().then(text => Promise.reject("Got non-200 response while fetching consumption data: " + text))
    )

    // Both timestamps in the url are treated as the end of the half-hour interval.
    const intensityDataUrl = `https://api.carbonintensity.org.uk/intensity/2023-01-01T00:30:00/2023-02-01T00:00:00`
    const intensityDataPromise = fetch(intensityDataUrl).then(res =>
        res.status == 200
            ? <Promise<IntensityData>>res.json().catch(err => Promise.reject("Failed to parse intensity data: " + err))
            : res.text().then(text => Promise.reject("Got non-200 response while fetching intensity data: " + text.replaceAll("\r", "\n")))
    )

    const fuelMixDataUrl = `https://api.carbonintensity.org.uk/generation/2023-01-01T00:30Z/2023-02-01T00:00Z`
    const fuelMixDataPromise = fetch(fuelMixDataUrl).then(res =>
        res.status == 200
            ? <Promise<FuelMixData>>res.json().catch(err => Promise.reject("Failed to parse fuel mix data: " + err))
            : res.text().then(text => Promise.reject("Got non-200 response while fetching fuel mix data: " + text.replaceAll("\r", "\n")))
    )

    return Promise.all([consumptionDataPromise, intensityDataPromise, fuelMixDataPromise])
}

function makeCalculations([consumptionData, intensityData, fuelMixData]: AllData) {
    // Calculate energy consumed in kWh.
    const energyConsumed = consumptionData.data.reduce((acc, cur) => acc + Number(cur.consumption), 0)

    // Calculate CO2 emitted in kg.
    // Consumption data tells us how much energy was consumed in kWh.
    // Intensity data tells us how much CO2 was emitted per kWh.
    // So we need to multiply the two to get the total CO2 emitted for each interval.
    // Then we need to sum all the intervals to get the total CO2 emitted.
    let co2Emitted = 0
    for (let index = 0; index < consumptionData.data.length; index++) {
        const intervalEnergyConsumed = Number(consumptionData.data[index].consumption)
        const intervalCarbonIntensity = intensityData.data[index].intensity.actual
        co2Emitted += intervalEnergyConsumed * intervalCarbonIntensity
    }
    co2Emitted /= 1000 // Convert gCO2 to kgCO2.

    // Calculate fuel mix used.
    const fuelMixUsedAcc: Record<Fuel, number> = {
        gas: 0,
        coal: 0,
        nuclear: 0,
        biomass: 0,
        hydro: 0,
        imports: 0,
        solar: 0,
        wind: 0,
        other: 0
    }
    const fuelMixUsed = fuelMixData.data.reduce((acc, cur) => {
        cur.generationmix.forEach(({ fuel, perc }) => {
            acc[fuel] += perc / fuelMixData.data.length
        })
        return acc
    }, fuelMixUsedAcc)

    // Print out the results.
    console.log(`Energy consumed: ${energyConsumed} kWh`)
    console.log(`CO2 emitted: ${co2Emitted.toFixed(2)} kg`)
    console.log(`Fuel mix used:`)
    Object.entries(fuelMixUsed)
        .sort((left, right) => right[1] - left[1])
        .forEach(([fuel, perc]) => console.log(`  ${fuel}: ${perc.toFixed(2)} %`))

    // Output:
    // Energy consumed: 96965 kWh
    // CO2 emitted: 14237.33 kg
    // Fuel mix used:
    //   wind: 38.42 %
    //   gas: 26.74 %
    //   nuclear: 15.14 %
    //   imports: 9.35 %
    //   biomass: 4.56 %
    //   hydro: 2.73 %
    //   coal: 1.82 %
    //   solar: 1.24 %
    //   other: 0.00 %
}

type AllData = [ConsumptionData, IntensityData, FuelMixData]

interface ConsumptionData {
    startInterval: string
    endInterval: string
    granularity: string
    data: {
        start_interval: string
        meter_id: string
        meter_number: string
        customer_id: string
        consumption: string // String probably because it can overflow. Let's not worry about that for now.
        consupmtion_units: string
    }[]
}

interface IntensityData {
    data: {
        from: string
        to: string
        intensity: {
            forecast: number
            actual: number
            index: string
        }
    }[]
}

interface FuelMixData {
    data: {
        from: string
        to: string
        generationmix: {
            fuel: Fuel
            perc: number
        }[]
    }[]
}

type Fuel = "gas" | "coal" | "nuclear" | "biomass" | "hydro" | "imports" | "solar" | "wind" | "other"

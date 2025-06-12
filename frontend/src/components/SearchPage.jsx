import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Search, Download, MapPin, Phone, Mail, Globe, Building2, Star } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SearchPage = () => {
  const [searchLocation, setSearchLocation] = useState("");
  const [selectedTrades, setSelectedTrades] = useState([]);
  const [radius, setRadius] = useState("20");
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const { toast } = useToast();

  const tradeTypes = [
    { value: "carpenter", label: "Carpenters & Joiners" },
    { value: "builder", label: "General Builders" },
    { value: "electrician", label: "Electricians" },
    { value: "plumber", label: "Plumbers" },
    { value: "roofer", label: "Roofing Specialists" },
    { value: "painter", label: "Decorators" },
    { value: "landscaper", label: "Landscapers" },
    { value: "plasterer", label: "Plasterers" },
    { value: "groundworker", label: "Groundworkers" },
    { value: "bricklayer", label: "Bricklayers & Stonemasons" },
    { value: "heating_engineer", label: "Heating Engineers" },
    { value: "kitchen_fitter", label: "Kitchen Fitters" },
    { value: "bathroom_fitter", label: "Bathroom Fitters" },
    { value: "tiler", label: "Tilers" }
  ];

  const handleTradeSelection = (tradeValue) => {
    setSelectedTrades(prev => {
      if (prev.includes(tradeValue)) {
        return prev.filter(trade => trade !== tradeValue);
      } else {
        return [...prev, tradeValue];
      }
    });
  };

  const handleSearch = async () => {
    if (!searchLocation.trim()) {
      toast({
        title: "Location Required",
        description: "Please enter a UK location or postcode to search",
        variant: "destructive",
      });
      return;
    }

    if (selectedTrades.length === 0) {
      toast({
        title: "Trade Type Required", 
        description: "Please select at least one trade type",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSearchPerformed(false);

    try {
      const radiusInMeters = parseInt(radius) * 1609.34; // Convert miles to meters
      
      const searchData = {
        location: searchLocation,
        radius: radiusInMeters,
        business_types: selectedTrades,
        max_results: 50
      };

      const response = await axios.post(`${API}/search-businesses`, searchData);
      
      if (response.data.success) {
        setSearchResults(response.data.businesses);
        setSearchPerformed(true);
        
        toast({
          title: "Search Complete",
          description: `Found ${response.data.businesses.length} businesses in ${searchLocation}`,
        });
      } else {
        throw new Error("Search failed");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search Failed",
        description: error.response?.data?.detail || "Failed to search for businesses. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    if (searchResults.length === 0) {
      toast({
        title: "No Data to Export",
        description: "Please perform a search first",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Company Name",
      "Tradesperson Name", 
      "Primary Industry",
      "Full Address",
      "Postcode",
      "Website URL",
      "Phone Number",
      "Email Address",
      "Source URL",
      "Date of Scraping",
      "Rating",
      "Total Ratings"
    ];

    const csvContent = [
      headers.join(","),
      ...searchResults.map(row =>
        [
          `"${row.company_name || ''}"`,
          `"${row.tradesperson_name || ''}"`,
          `"${row.primary_industry || ''}"`,
          `"${row.full_address || ''}"`,
          `"${row.postcode || ''}"`,
          `"${row.website_url || ''}"`,
          `"${row.phone_number || ''}"`,
          `"${row.email_address || ''}"`,
          `"${row.source_url || ''}"`,
          `"${row.date_of_scraping || ''}"`,
          `"${row.rating || ''}"`,
          `"${row.total_ratings || ''}"`
        ].join(",")
      )
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `trade_contacts_${searchLocation.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: `Exported ${searchResults.length} contacts to CSV`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-2 rounded-lg">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  UK Trade Contact Intelligence
                </h1>
                <p className="text-sm text-gray-600 mt-1">Find construction professionals for your business</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Form */}
        <Card className="mb-8 shadow-lg border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-t-lg">
            <CardTitle className="flex items-center space-x-2 text-2xl">
              <Search className="h-6 w-6 text-blue-600" />
              <span>Search Trade Contacts</span>
            </CardTitle>
            <CardDescription className="text-base">
              Find construction and trade professionals using Google Places API
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="location" className="text-sm font-medium flex items-center">
                  <MapPin className="h-4 w-4 mr-1 text-blue-600" />
                  Location
                </Label>
                <Input
                  id="location"
                  placeholder="e.g., London, SW1A 1AA, Manchester"
                  value={searchLocation}
                  onChange={(e) => setSearchLocation(e.target.value)}
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="radius" className="text-sm font-medium">Radius</Label>
                <Select value={radius} onValueChange={setRadius}>
                  <SelectTrigger className="border-gray-300 focus:border-blue-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 miles</SelectItem>
                    <SelectItem value="10">10 miles</SelectItem>
                    <SelectItem value="20">20 miles</SelectItem>
                    <SelectItem value="50">50 miles</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6">
              <Label className="text-sm font-medium mb-3 block">Select Trade Types</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {tradeTypes.map((trade) => (
                  <div
                    key={trade.value}
                    onClick={() => handleTradeSelection(trade.value)}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:scale-105 ${
                      selectedTrades.includes(trade.value)
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div className="text-sm font-medium">{trade.label}</div>
                  </div>
                ))}
              </div>
              {selectedTrades.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedTrades.map(trade => {
                    const tradeObj = tradeTypes.find(t => t.value === trade);
                    return (
                      <Badge key={trade} variant="secondary" className="bg-blue-100 text-blue-800">
                        {tradeObj?.label}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mt-6">
              <Button
                onClick={handleSearch}
                disabled={isLoading}
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-8 py-2 text-base font-medium"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Searching Google Places...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search Contacts
                  </>
                )}
              </Button>

              {searchResults.length > 0 && (
                <Button
                  onClick={exportToCSV}
                  variant="outline"
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV ({searchResults.length})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {searchPerformed && (
          <Card className="shadow-lg border-0">
            <CardHeader className="bg-gradient-to-r from-gray-50 to-blue-50">
              <CardTitle className="text-xl">
                Search Results ({searchResults.length})
              </CardTitle>
              <CardDescription>
                Showing trade contacts in {searchLocation} (within {radius} miles) - Data from Google Places API
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs defaultValue="table" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="table">Table View</TabsTrigger>
                  <TabsTrigger value="cards">Card View</TabsTrigger>
                </TabsList>
                
                <TabsContent value="table" className="mt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="font-semibold">Company</TableHead>
                          <TableHead className="font-semibold">Trade</TableHead>
                          <TableHead className="font-semibold">Location</TableHead>
                          <TableHead className="font-semibold">Contact Info</TableHead>
                          <TableHead className="font-semibold">Rating</TableHead>
                          <TableHead className="font-semibold">Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchResults.map((contact, index) => (
                          <TableRow key={index} className="hover:bg-gray-50/50">
                            <TableCell className="font-medium">
                              <div>
                                <div className="font-semibold text-gray-900">{contact.company_name}</div>
                                {contact.website_url && (
                                  <a 
                                    href={contact.website_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 text-sm hover:underline flex items-center mt-1"
                                  >
                                    <Globe className="h-3 w-3 mr-1" />
                                    Website
                                  </a>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                {contact.primary_industry}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div className="text-gray-900">{contact.full_address}</div>
                                {contact.postcode && (
                                  <div className="text-gray-500 mt-1 font-mono">{contact.postcode}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {contact.phone_number && (
                                  <div className="flex items-center text-sm text-gray-600">
                                    <Phone className="h-3 w-3 mr-1" />
                                    {contact.phone_number}
                                  </div>
                                )}
                                {contact.email_address && (
                                  <div className="flex items-center text-sm text-gray-600">
                                    <Mail className="h-3 w-3 mr-1" />
                                    {contact.email_address}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {contact.rating && (
                                <div className="flex items-center text-sm">
                                  <Star className="h-3 w-3 text-yellow-500 mr-1" />
                                  <span className="font-medium">{contact.rating}</span>
                                  {contact.total_ratings && (
                                    <span className="text-gray-500 ml-1">({contact.total_ratings})</span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                Google Places
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="cards" className="mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                    {searchResults.map((contact, index) => (
                      <Card key={index} className="hover:shadow-lg transition-shadow">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg text-gray-900">{contact.company_name}</CardTitle>
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                              {contact.primary_industry}
                            </Badge>
                            {contact.rating && (
                              <div className="flex items-center text-sm">
                                <Star className="h-4 w-4 text-yellow-500 mr-1" />
                                <span className="font-medium">{contact.rating}</span>
                                {contact.total_ratings && (
                                  <span className="text-gray-500 ml-1">({contact.total_ratings})</span>
                                )}
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">                          
                          <div className="space-y-2 text-sm">
                            <div className="flex items-start">
                              <MapPin className="h-4 w-4 mr-2 mt-0.5 text-gray-500 flex-shrink-0" />
                              <div>
                                <div>{contact.full_address}</div>
                                {contact.postcode && (
                                  <div className="font-mono text-gray-500">{contact.postcode}</div>
                                )}
                              </div>
                            </div>
                            
                            {contact.phone_number && (
                              <div className="flex items-center">
                                <Phone className="h-4 w-4 mr-2 text-gray-500" />
                                <span>{contact.phone_number}</span>
                              </div>
                            )}
                            
                            {contact.email_address && (
                              <div className="flex items-center">
                                <Mail className="h-4 w-4 mr-2 text-gray-500" />
                                <span className="text-blue-600">{contact.email_address}</span>
                              </div>
                            )}
                            
                            {contact.website_url && (
                              <div className="flex items-center">
                                <Globe className="h-4 w-4 mr-2 text-gray-500" />
                                <a 
                                  href={contact.website_url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  Visit Website
                                </a>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {searchPerformed && searchResults.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <div className="text-gray-500 text-lg">
                No trade contacts found for your search criteria.
              </div>
              <div className="text-gray-400 text-sm mt-2">
                Try adjusting your location or expanding your search radius.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default SearchPage;